import json
import random
from datetime import datetime, timezone
from collections import defaultdict
from otree.api import *

from .allocation import run_allocation


doc = "Snack allocation experiment (backend)."


# -------------------
# CONSTANTS
# -------------------
class C(BaseConstants):
    NAME_IN_URL = "my_experiment"
    PLAYERS_PER_GROUP = 6
    NUM_ROUNDS = 1

    # Switch allocation algorithm here:
    # "rsd" now; later we can add "da" without rewriting page logic.
    ALLOCATION_ALGO = "rsd"

    # Version string for your experiment design / schema.
    # Update this whenever you change data format or logic.
    DESIGN_VERSION = "v2026-03-06"

    # IMPORTANT: Keep snack IDs consistent across frontend/back-end.
    SNACK_IDS = ["snack1", "snack2", "snack3", "snack4", "snack5", "snack6"]


# -------------------
# MODELS
# -------------------
class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    # Seed used to make allocation reproducible within a session.
    allocation_seed = models.IntegerField(blank=True)

    # Seed used to make ranking tie-breaking reproducible within a session.
    ranking_seed = models.IntegerField(blank=True)


class Player(BasePlayer):
    # Raw trial-level data from frontend JS (serialized JSON string).
    # Fallback only (if you do not implement real-time trial saving).
    binary_rows_json = models.LongStringField(blank=True)

    # WTP rows from frontend JS (serialized JSON string).
    # Each element should be a dict with at least:
    # {"snack_id": "...", "bid_value": 1.23, "price_draw": 0.50}
    wtp_rows_json = models.LongStringField(blank=True)

    # Inferred strict ranking over snacks, stored as JSON string.
    inferred_ranking_json = models.LongStringField(blank=True)

    # Debug: win counts per snack, stored as JSON string.
    win_counts_json = models.LongStringField(blank=True)

    # Dataset 2 rows (snack-level; 6 rows per participant), stored as JSON string.
    # Each element is a dict:
    # {session_id, subject_id, snack_id, win_count, tie_group_id, final_rank}
    ranking_rows_json = models.LongStringField(blank=True)

    # Final snack assigned by the allocation mechanism (RSD for now).
    assigned_snack = models.StringField(blank=True)

    # Position in the RSD order (1 = first dictator).
    rsd_order = models.IntegerField(blank=True)

    # Assigned snack's rank position (1..6) in participant's inferred ranking.
    assigned_rank_pos = models.IntegerField(blank=True)


class ChoiceTrial(ExtraModel):
    """
    Trial-level storage for binary choice task (recommended for reliability).

    If the frontend sends each trial via liveSend, you will get a durable
    database record per trial. This prevents losing all data if the browser
    crashes before submitting the final page.
    """
    player = models.Link(Player)

    session_id = models.StringField()
    subject_id = models.StringField()

    trial_index = models.IntegerField()
    pair_id = models.StringField()

    left_item_id = models.StringField()
    right_item_id = models.StringField()

    chosen_item = models.StringField(blank=True)
    rt_ms = models.FloatField(blank=True)

    is_timeout = models.BooleanField(initial=False)

    # Optional: useful for debugging latency/network issues.
    timestamp_utc = models.StringField(blank=True)


class WTPRow(ExtraModel):
    """
    Snack-level storage for WTP (C1 + price_draw):
    session_id, subject_id, snack_id, bid_value, price_draw
    """
    player = models.Link(Player)

    session_id = models.StringField()
    subject_id = models.StringField()

    snack_id = models.StringField()
    bid_value = models.FloatField()
    price_draw = models.FloatField(blank=True)


# -------------------
# HELPERS
# -------------------
def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_json_list(s):
    """Parse a JSON string into list[dict]. Return [] on any failure."""
    if not s:
        return []
    try:
        x = json.loads(s)
        return x if isinstance(x, list) else []
    except Exception:
        return []


def _filter_valid_main_trials(rows):
    """
    Keep only VALID main-task rows:
    - is_practice == 0 (or missing -> treated as 0)
    - is_timeout == 0
    - chosen_item_id non-empty
    """
    kept = []
    for r in rows:
        if int(r.get("is_practice", 0) or 0) != 0:
            continue
        if int(r.get("is_timeout", 0) or 0) != 0:
            continue
        chosen = (r.get("chosen_item_id") or "").strip()
        if chosen == "":
            continue
        kept.append(r)
    return kept


def _infer_ranking_win_count_random_ties(*, valid_rows, snack_ids, seed):
    """
    Win-count scoring + random tie-breaking.

    Args:
        valid_rows: list[dict], each dict must include chosen_item_id
        snack_ids: list[str]
        seed: int, for reproducible randomization

    Returns:
        ranking (list[str]): strict best->worst
        win_counts (dict[str,int])
        tie_group_id_by_snack (dict[str,int])
        final_rank_by_snack (dict[str,int])
    """
    rng = random.Random(int(seed))

    # 1) win-counts
    win_counts = {sid: 0 for sid in snack_ids}
    for r in valid_rows:
        chosen = (r.get("chosen_item_id") or "").strip()
        if chosen in win_counts:
            win_counts[chosen] += 1

    # 2) tie groups by identical win-count, ordered by score desc.
    unique_scores = sorted({win_counts[sid] for sid in snack_ids}, reverse=True)
    tie_group_id_by_score = {score: idx + 1 for idx, score in enumerate(unique_scores)}
    tie_group_id_by_snack = {sid: tie_group_id_by_score[win_counts[sid]] for sid in snack_ids}

    # 3) strict ranking: randomize within each tie group
    ranking = []
    for score in unique_scores:
        members = [sid for sid in snack_ids if win_counts[sid] == score]
        rng.shuffle(members)
        ranking.extend(members)

    final_rank_by_snack = {sid: idx + 1 for idx, sid in enumerate(ranking)}
    return ranking, win_counts, tie_group_id_by_snack, final_rank_by_snack


def _get_subject_id(player: Player) -> str:
    """
    Subject ID for exports. Prefer participant.code because it's globally unique.
    """
    return getattr(player.participant, "code", None) or f"P{player.id_in_group}"


def _get_session_id(player: Player) -> str:
    """
    Session ID for exports. Use session.code (stable unique id in oTree).
    """
    return getattr(player.session, "code", None) or "UNKNOWN_SESSION"


def _read_trials_for_player(player: Player):
    """
    Preferred: read from ChoiceTrial table.
    Fallback: read from player.binary_rows_json (legacy approach).
    Output: list of dict rows in the SAME shape as frontend row dicts
            used for inference: must contain chosen_item_id, is_practice, is_timeout, etc.
    """
    session_id = _get_session_id(player)
    subject_id = _get_subject_id(player)

    trials = ChoiceTrial.filter(player=player)
    if trials:
        # Convert ChoiceTrial -> row dict compatible with ranking inference.
        rows = []
        for t in sorted(trials, key=lambda x: x.trial_index):
            rows.append(
                dict(
                    is_practice=0,
                    is_timeout=1 if t.is_timeout else 0,
                    chosen_item_id=t.chosen_item or "",
                    # optional fields kept if you want:
                    left_item_id=t.left_item_id,
                    right_item_id=t.right_item_id,
                    rt_ms=t.rt_ms,
                    pair_id=t.pair_id,
                    trial_index=t.trial_index,
                    session_id=session_id,
                    subject_id=subject_id,
                )
            )
        return rows

    # Fallback to JSON stored at end of MyPage submission
    return _parse_json_list(player.binary_rows_json)


# -------------------
# PAGES
# -------------------
class Consent(Page):
    pass


class InstructionsBDM(Page):
    pass


class WTP(Page):
    """
    WTP is currently rendered by JS.
    To export WTP rows from server, the JS must store results into a hidden
    input bound to Player.wtp_rows_json, then submit this page.
    """
    form_model = "player"
    form_fields = ["wtp_rows_json"]


class InstructionsBinary(Page):
    pass


class MyPage(Page):
    """
    Binary-choice task page.

    Fallback storage:
    - JS writes all trial rows into a hidden input (binary_rows_json)
    - On submit, the full JSON is stored into Player.binary_rows_json

    Recommended robust storage:
    - JS calls liveSend() for each trial, which appends to ChoiceTrial (DB)
    """
    form_model = "player"
    form_fields = ["binary_rows_json"]

    @staticmethod
    def live_method(player: Player, data):
        """
        Real-time trial saving endpoint.

        Expected payload example from JS (per trial):
        {
          "type": "choice_trial",
          "trial_index": 1,
          "pair_id": "pair_01",
          "left_item_id": "snack1",
          "right_item_id": "snack4",
          "chosen_item": "snack4",     # empty string if timeout
          "rt_ms": 1532,
          "is_timeout": false,
          "timestamp_utc": "2026-03-05T12:34:56Z"  # optional
        }

        You should also include a client-generated unique event id if you want
        deduplication. For now, we assume (player, trial_index) is unique.
        """
        if not isinstance(data, dict):
            return

        if data.get("type") != "choice_trial":
            return

        session_id = _get_session_id(player)
        subject_id = _get_subject_id(player)

        # Basic validation / normalization
        trial_index = int(data.get("trial_index", 0) or 0)
        if trial_index <= 0:
            return

        pair_id = str(data.get("pair_id", "") or "")
        left_item_id = str(data.get("left_item_id", "") or "")
        right_item_id = str(data.get("right_item_id", "") or "")
        chosen_item = str(data.get("chosen_item", "") or "")
        is_timeout = bool(data.get("is_timeout", False))
        rt_ms = data.get("rt_ms", None)

        try:
            rt_ms = float(rt_ms) if rt_ms is not None and rt_ms != "" else None
        except Exception:
            rt_ms = None

        timestamp_utc = str(data.get("timestamp_utc", "") or "")

        # Dedup: avoid inserting the same (player, trial_index) twice
        existing = ChoiceTrial.filter(player=player, trial_index=trial_index)
        if existing:
            return dict(ok=True, dedup=True)

        ChoiceTrial.create(
            player=player,
            session_id=session_id,
            subject_id=subject_id,
            trial_index=trial_index,
            pair_id=pair_id,
            left_item_id=left_item_id,
            right_item_id=right_item_id,
            chosen_item=chosen_item,
            rt_ms=rt_ms,
            is_timeout=is_timeout,
            timestamp_utc=timestamp_utc,
        )
        return dict(ok=True, saved=True)


class ResultsWaitPage(WaitPage):
    """
    After all 6 participants arrive:
    1) infer each participant's ranking (win-count + random ties)
    2) run allocation (RSD now)
    3) store assignment results
    4) store WTP rows into ExtraModel (if wtp_rows_json provided)
    """

    def after_all_players_arrive(self):
        players = self.group.get_players()

        # Ensure seeds exist so results are reproducible.
        if self.group.field_maybe_none("ranking_seed") is None:
            self.group.ranking_seed = random.randint(1, 10_000_000)
        if self.group.field_maybe_none("allocation_seed") is None:
            self.group.allocation_seed = random.randint(1, 10_000_000)

        # ---- 0) Persist WTP rows (if page submitted them) ----
        # Note: This is safe even if already inserted; we dedup by (player, snack_id).
        for p in players:
            session_id = _get_session_id(p)
            subject_id = _get_subject_id(p)

            wtp_rows = _parse_json_list(p.wtp_rows_json)
            for r in wtp_rows:
                snack_id = str(r.get("snack_id", "") or "")
                if snack_id == "":
                    continue
                try:
                    bid_value = float(r.get("bid_value"))
                except Exception:
                    continue
                price_draw = r.get("price_draw", None)
                try:
                    price_draw = float(price_draw) if price_draw not in (None, "") else None
                except Exception:
                    price_draw = None

                if WTPRow.filter(player=p, snack_id=snack_id):
                    continue

                WTPRow.create(
                    player=p,
                    session_id=session_id,
                    subject_id=subject_id,
                    snack_id=snack_id,
                    bid_value=bid_value,
                    price_draw=price_draw,
                )

        # ---- 1) Infer rankings ----
        rankings = {}
        for p in players:
            session_id = _get_session_id(p)
            subject_id = _get_subject_id(p)

            raw_rows = _read_trials_for_player(p)
            valid_rows = _filter_valid_main_trials(raw_rows)

            # Derive a per-player seed so tie-breaking differs across players
            # but remains reproducible within the session.
            per_player_seed = int(self.group.ranking_seed) * 100 + int(p.id_in_group)

            ranking, win_counts, tie_group_id_by_snack, final_rank_by_snack = (
                _infer_ranking_win_count_random_ties(
                    valid_rows=valid_rows,
                    snack_ids=C.SNACK_IDS,
                    seed=per_player_seed,
                )
            )

            # Build Dataset 2 rows (6 rows per participant)
            ranking_rows = []
            for snack_id in C.SNACK_IDS:
                ranking_rows.append(
                    dict(
                        session_id=session_id,
                        subject_id=subject_id,
                        snack_id=snack_id,
                        win_count=int(win_counts[snack_id]),
                        tie_group_id=int(tie_group_id_by_snack[snack_id]),
                        final_rank=int(final_rank_by_snack[snack_id]),
                    )
                )

            p.inferred_ranking_json = json.dumps(ranking)
            p.win_counts_json = json.dumps(win_counts)
            p.ranking_rows_json = json.dumps(ranking_rows)

            rankings[p.id_in_group] = ranking

        # ---- 2) Allocation ----
        assignment, order, meta = run_allocation(
            algo_name=C.ALLOCATION_ALGO,
            player_ids=[p.id_in_group for p in players],
            rankings=rankings,
            seed=self.group.allocation_seed,
        )

        # ---- 3) Store allocation results + assigned_rank_pos ----
        for p in players:
            p.assigned_snack = assignment.get(p.id_in_group, "")

            # RSD order position
            if order is not None and p.id_in_group in order:
                p.rsd_order = order.index(p.id_in_group) + 1
            else:
                p.rsd_order = None

            # assigned_rank_pos (1..6) from inferred ranking
            try:
                ranking = json.loads(p.inferred_ranking_json or "[]")
                if p.assigned_snack in ranking:
                    p.assigned_rank_pos = ranking.index(p.assigned_snack) + 1
                else:
                    p.assigned_rank_pos = None
            except Exception:
                p.assigned_rank_pos = None


class Results(Page):
    def vars_for_template(self):
        try:
            ranking = json.loads(self.inferred_ranking_json or "[]")
        except Exception:
            ranking = []

        try:
            win_counts = json.loads(self.win_counts_json or "{}")
        except Exception:
            win_counts = {}

        return dict(
            # ADDED:
            # Keep this debug field because Results.html still references it.
            # It shows the raw JSON length of submitted binary trial data.
            debug_json_len=len(self.binary_rows_json or ""),

            inferred_ranking=ranking,
            win_counts=win_counts,
            assigned_snack=self.assigned_snack,
            rsd_order=self.rsd_order,
            assigned_rank_pos=self.assigned_rank_pos,
            allocation_algo=C.ALLOCATION_ALGO,
        )


page_sequence = [
    Consent,
    InstructionsBDM,
    WTP,
    InstructionsBinary,
    MyPage,
    ResultsWaitPage,
    Results,
]


# -------------------
# CUSTOM EXPORTS (oTree 6+)
# Each function produces ONE CSV table in Admin -> Data.
# oTree supports multiple custom exports by defining multiple functions
# whose names start with "custom_export". :contentReference[oaicite:1]{index=1}
# -------------------
def custom_export_metadata_session(players):
    """
    Session-level metadata: one row per session.
    """
    yield [
        "session_id",
        "export_time_utc",
        "app_name",
        "design_version",
        "players_per_group",
        "snack_ids",
        "ranking_rule",
        "ranking_seed",
        "allocation_algo",
        "allocation_seed",
    ]

    # We may be exporting multiple sessions in one file.
    # So we group by session_id.
    seen = set()
    for p in players:
        sess_id = _get_session_id(p)
        if sess_id in seen:
            continue
        seen.add(sess_id)
        g = p.group
        yield [
            sess_id,
            _utc_now_iso(),
            C.NAME_IN_URL,
            C.DESIGN_VERSION,
            C.PLAYERS_PER_GROUP,
            "|".join(C.SNACK_IDS),
            "win_count_random_tiebreak",
            g.ranking_seed,
            C.ALLOCATION_ALGO,
            g.allocation_seed,
        ]


def custom_export_choice_trials(players):
    """
    Dataset 1: Binary Choice Trials (trial-level).
    Columns (as you specified):
    session_id, subject_id, trial_index, pair_id, left_item_id, right_item_id,
    chosen_item, rt_ms, is_timeout
    """
    yield [
        "session_id",
        "subject_id",
        "trial_index",
        "pair_id",
        "left_item_id",
        "right_item_id",
        "chosen_item",
        "rt_ms",
        "is_timeout",
    ]

    # Prefer ExtraModel ChoiceTrial; fallback to JSON if no ChoiceTrial exists.
    for p in players:
        sess_id = _get_session_id(p)
        subj_id = _get_subject_id(p)

        trials = ChoiceTrial.filter(player=p)
        if trials:
            for t in sorted(trials, key=lambda x: x.trial_index):
                yield [
                    sess_id,
                    subj_id,
                    t.trial_index,
                    t.pair_id,
                    t.left_item_id,
                    t.right_item_id,
                    t.chosen_item,
                    t.rt_ms,
                    1 if t.is_timeout else 0,
                ]
        else:
            rows = _parse_json_list(p.binary_rows_json)
            # If your JSON rows already contain these keys, we export them.
            # Missing keys are exported as blank.
            for r in rows:
                yield [
                    sess_id,
                    subj_id,
                    r.get("trial_index", ""),
                    r.get("pair_id", ""),
                    r.get("left_item_id", ""),
                    r.get("right_item_id", ""),
                    r.get("chosen_item_id", ""),
                    r.get("rt_ms", ""),
                    r.get("is_timeout", ""),
                ]


def custom_export_ranking(players):
    """
    Dataset 2: ranking_subject_<subject_id>.csv equivalent, but as one merged table.
    Columns:
    session_id, subject_id, snack_id, win_count, tie_group_id, final_rank
    """
    yield [
        "session_id",
        "subject_id",
        "snack_id",
        "win_count",
        "tie_group_id",
        "final_rank",
    ]

    for p in players:
        rows = _parse_json_list(p.ranking_rows_json)
        for r in rows:
            yield [
                r.get("session_id", _get_session_id(p)),
                r.get("subject_id", _get_subject_id(p)),
                r.get("snack_id", ""),
                r.get("win_count", ""),
                r.get("tie_group_id", ""),
                r.get("final_rank", ""),
            ]


def custom_export_wtp(players):
    """
    Dataset 5 (C1 + price_draw):
    session_id, subject_id, snack_id, bid_value, price_draw
    """
    yield ["session_id", "subject_id", "snack_id", "bid_value", "price_draw"]

    # Prefer ExtraModel WTPRow (if submitted); fallback to wtp_rows_json if needed.
    for p in players:
        sess_id = _get_session_id(p)
        subj_id = _get_subject_id(p)

        rows = WTPRow.filter(player=p)
        if rows:
            for r in rows:
                yield [sess_id, subj_id, r.snack_id, r.bid_value, r.price_draw]
        else:
            wtp_rows = _parse_json_list(p.wtp_rows_json)
            for r in wtp_rows:
                yield [
                    sess_id,
                    subj_id,
                    r.get("snack_id", ""),
                    r.get("bid_value", ""),
                    r.get("price_draw", ""),
                ]


def custom_export_matching_rsd(players):
    """
    Dataset 3 (RSD):
    session_id, subject_id, serial_position, assigned_snack_id, assigned_rank_pos
    """
    yield [
        "session_id",
        "subject_id",
        "serial_position",
        "assigned_snack_id",
        "assigned_rank_pos",
    ]

    for p in players:
        yield [
            _get_session_id(p),
            _get_subject_id(p),
            p.rsd_order,
            p.assigned_snack,
            p.assigned_rank_pos,
        ]


def custom_export_matching_da(players):
    """
    Dataset 4 (DA) placeholder:
    session_id, subject_id, assigned_snack_id, assigned_rank_pos, consistency_index

    If DA is not implemented yet, export NA for these fields.
    Later you can compute and store DA outcomes into Player fields or an ExtraModel.
    """
    yield [
        "session_id",
        "subject_id",
        "assigned_snack_id",
        "assigned_rank_pos",
        "consistency_index",
    ]

    for p in players:
        yield [
            _get_session_id(p),
            _get_subject_id(p),
            "",   # assigned_snack_id for DA
            "",   # assigned_rank_pos for DA
            "",   # consistency_index
        ]