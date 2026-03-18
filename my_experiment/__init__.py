import json
import random
from datetime import datetime, timezone

from otree.api import *

from .allocation import run_allocation


doc = """
Snack allocation experiment.

Each participant first reports willingness to pay (WTP) for six snacks,
then completes a binary choice task over snack pairs.

The backend uses the binary choices to infer a strict ranking over snacks.
A group-level allocation rule (currently RSD) then assigns one snack to
each participant based on the inferred rankings.

Although the frontend submits compact JSON blobs, the backend also stores
structured rows through ExtraModel tables so that exports remain stable
and easy to analyze.
"""


# =============================================================================
# CONSTANTS
# =============================================================================
class C(BaseConstants):
    NAME_IN_URL = "my_experiment"
    PLAYERS_PER_GROUP = 6
    NUM_ROUNDS = 1

    # The allocation rule currently used by the experiment.
    # Other rules can be added through the allocation module.
    ALLOCATION_ALGO = "rsd"

    # A simple label that helps identify the current data contract.
    DESIGN_VERSION = "main-fields-backend-rsd"

    # These IDs must match the item IDs used in the frontend files.
    SNACK_IDS = ["snack1", "snack2", "snack3", "snack4", "snack5", "snack6"]

    # Stage 3 policy: number of repeat cycles preallocated in page_sequence.
    # oTree page_sequence is static, so strict infinity is not possible.
    # Set this high to make repeat effectively always available in practice.
    MAX_PRACTICE_REPEAT_CYCLES = 20


# =============================================================================
# CORE OTree MODELS
# =============================================================================
class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    # Used to make allocation reproducible within a session.
    allocation_seed = models.IntegerField(blank=True)

    # Used to make ranking tie-breaking reproducible within a session.
    ranking_seed = models.IntegerField(blank=True)


class Player(BasePlayer):
    # -------------------------------------------------------------------------
    # Backend phase state (Stage 1 foundation)
    # -------------------------------------------------------------------------
    # Source of truth for whether the participant is in practice or real flow.
    current_phase = models.StringField(initial="practice")

    # Last checkpoint decision submitted by the participant.
    # Stage 2 will connect this to form handling on PracticeCheckpoint.
    practice_decision = models.StringField(blank=True)

    # How many times the participant requested practice repetition.
    practice_repeat_count = models.IntegerField(initial=0)

    # Whether the participant has completed at least one practice block.
    practice_completed = models.BooleanField(initial=False)

    # Whether the participant has entered the real block.
    real_started = models.BooleanField(initial=False)

    # -------------------------------------------------------------------------
    # Raw frontend payloads
    # -------------------------------------------------------------------------
    # Main-task binary choices submitted by the frontend as one JSON list.
    # This is the only binary-task field expected by this version of the app.
    choice_data_json = models.LongStringField(blank=True)
    # Practice binary payload kept separate from formal data.
    choice_data_json_practice = models.LongStringField(blank=True)

    # WTP rows submitted by the frontend as one JSON list.
    # This is the only WTP field expected by this version of the app.
    wtp_data_json = models.LongStringField(blank=True)
    # Practice WTP payload kept separate from formal data.
    wtp_data_json_practice = models.LongStringField(blank=True)

    # -------------------------------------------------------------------------
    # Derived backend results
    # -------------------------------------------------------------------------
    # Final inferred strict ranking over all snacks, stored as JSON.
    inferred_ranking_json = models.LongStringField(blank=True)

    # Win counts used to construct the inferred ranking.
    win_counts_json = models.LongStringField(blank=True)

    # One structured ranking row per snack, stored as JSON for convenient export.
    ranking_rows_json = models.LongStringField(blank=True)

    # Final assignment result produced by the allocation rule.
    assigned_snack = models.StringField(blank=True)

    # Participant's position in the RSD order.
    rsd_order = models.IntegerField(blank=True)

    # Position of the assigned snack in the participant's inferred ranking.
    assigned_rank_pos = models.IntegerField(blank=True)

    def ensure_backend_state_initialized(self):
        """
        Keep backend phase-state fields in a valid baseline state.

        This method is idempotent and safe to call from multiple pages.
        """
        current_phase = self.field_maybe_none("current_phase")
        if current_phase not in ("practice", "real"):
            self.current_phase = "practice"

        practice_decision = self.field_maybe_none("practice_decision")
        if practice_decision not in ("", "repeat", "begin"):
            self.practice_decision = ""

        practice_repeat_count = self.field_maybe_none("practice_repeat_count")
        if practice_repeat_count is None:
            self.practice_repeat_count = 0

        practice_completed = self.field_maybe_none("practice_completed")
        if practice_completed is None:
            self.practice_completed = False

        real_started = self.field_maybe_none("real_started")
        if real_started is None:
            self.real_started = False

# =============================================================================
# EXTRA TABLES
# =============================================================================
class ChoiceTrial(ExtraModel):
    """
    One row per binary-choice trial.

    The frontend may send trials one at a time through liveSend().
    Storing them here helps prevent data loss if the page closes before the
    full JSON payload is submitted at the end of the task.
    """

    player = models.Link(Player)

    session_id = models.StringField()
    subject_id = models.StringField()
    # Distinguish practice vs real for live-save and dedup safety.
    phase = models.StringField(initial="real")

    trial_index = models.IntegerField()
    pair_id = models.StringField()

    left_item_id = models.StringField()
    right_item_id = models.StringField()

    chosen_item = models.StringField(blank=True)
    rt_ms = models.FloatField(blank=True)

    is_timeout = models.BooleanField(initial=False)
    timestamp_utc = models.StringField(blank=True)


class WTPRow(ExtraModel):
    """
    One row per snack for the WTP task.

    The frontend may include many display-oriented columns, but the backend
    stores only the fields needed for later analysis:
    session_id, subject_id, snack_id, bid_value, price_draw.
    """

    player = models.Link(Player)

    session_id = models.StringField()
    subject_id = models.StringField()

    snack_id = models.StringField()
    bid_value = models.FloatField()
    price_draw = models.FloatField(blank=True)


# =============================================================================
# GENERAL HELPERS
# =============================================================================
def _utc_now_iso():
    """Return the current UTC time in ISO format."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_json_list(raw_value):
    """
    Parse a JSON string into a list.

    The frontend stores several datasets as JSON strings. For robustness, this
    helper returns an empty list if the field is empty, malformed, or not a list.
    """
    if not raw_value:
        return []

    try:
        parsed = json.loads(raw_value)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _get_subject_id(player: Player) -> str:
    """
    Return a participant-level identifier suitable for exports.

    participant.code is preferred because it is stable and unique within oTree.
    """
    return getattr(player.participant, "code", None) or f"P{player.id_in_group}"


def _get_session_id(player: Player) -> str:
    """
    Return a session-level identifier suitable for exports.

    session.code is preferred because it is stable and unique within oTree.
    """
    return getattr(player.session, "code", None) or "UNKNOWN_SESSION"


# =============================================================================
# INPUT READERS
# =============================================================================
def _read_binary_rows_from_player(player: Player):
    """
    Read binary-task rows from the main frontend field.

    The frontend is expected to submit a JSON list through choice_data_json.
    """
    return _parse_json_list(player.choice_data_json)


def _read_binary_rows_from_player_practice(player: Player):
    """
    Read practice binary-task rows from the practice-only storage field.
    """
    return _parse_json_list(player.choice_data_json_practice)


def _current_backend_phase(player: Player) -> str:
    """Return backend phase label for task writes and live saves."""
    player.ensure_backend_state_initialized()
    return "real" if bool(player.field_maybe_none("real_started")) else "practice"


def _read_wtp_rows_from_player(player: Player):
    """
    Read WTP rows from the main frontend field.

    The frontend is expected to submit a JSON list through wtp_data_json.
    """
    return _parse_json_list(player.wtp_data_json)


def _read_wtp_rows_from_player_practice(player: Player):
    """
    Read practice WTP rows from the practice-only storage field.
    """
    return _parse_json_list(player.wtp_data_json_practice)


def _normalize_wtp_rows(raw_rows):
    """
    Convert raw frontend WTP rows into one compact backend schema.

    The frontend may include many display-oriented fields such as:
        snack_label, payment, remaining_cash, purchase_decision, etc.

    The backend keeps only the fields needed downstream:
        snack_id, bid_value, price_draw

    Expected frontend row shape:
        {
            "snack_id": "snack1",
            "bid": "0.75",
            "price_draw": "0.50",
            ...
        }

    Returned backend row shape:
        {
            "snack_id": "snack1",
            "bid_value": 0.75,
            "price_draw": 0.50 or None
        }
    """
    normalized = []

    for row in raw_rows:
        if not isinstance(row, dict):
            continue

        snack_id = str(row.get("snack_id", "") or "").strip()
        if not snack_id:
            continue

        bid_raw = row.get("bid", None)
        try:
            bid_value = float(bid_raw)
        except Exception:
            continue

        price_raw = row.get("price_draw", None)
        try:
            price_draw = float(price_raw) if price_raw not in (None, "") else None
        except Exception:
            price_draw = None

        normalized.append(
            dict(
                snack_id=snack_id,
                bid_value=bid_value,
                price_draw=price_draw,
            )
        )

    return normalized


# =============================================================================
# RANKING HELPERS
# =============================================================================
def _filter_valid_choice_rows(rows):
    """
    Keep only valid non-practice rows for ranking inference.

    The ranking logic ignores:
    - practice trials
    - timed-out trials
    - rows without a recorded choice
    """
    kept = []

    for row in rows:
        if int(row.get("is_practice", 0) or 0) != 0:
            continue

        if int(row.get("is_timeout", 0) or 0) != 0:
            continue

        chosen_item = (row.get("chosen_item_id") or "").strip()
        if chosen_item == "":
            continue

        kept.append(row)

    return kept


def _infer_ranking_win_count_random_ties(*, valid_rows, snack_ids, seed):
    """
    Infer a strict ranking from binary choices.

    Step 1:
        Count how many times each snack was chosen.

    Step 2:
        Sort snacks by win count from high to low.

    Step 3:
        If multiple snacks have the same win count, break ties randomly
        using a seeded RNG so results remain reproducible.

    Returns:
        ranking                 list of snack IDs from best to worst
        win_counts              dict snack_id -> number of wins
        tie_group_id_by_snack   dict snack_id -> tie tier label
        final_rank_by_snack     dict snack_id -> final rank position
    """
    rng = random.Random(int(seed))

    win_counts = {snack_id: 0 for snack_id in snack_ids}
    for row in valid_rows:
        chosen = (row.get("chosen_item_id") or "").strip()
        if chosen in win_counts:
            win_counts[chosen] += 1

    unique_scores = sorted({win_counts[sid] for sid in snack_ids}, reverse=True)

    tie_group_id_by_score = {
        score: idx + 1 for idx, score in enumerate(unique_scores)
    }

    tie_group_id_by_snack = {
        sid: tie_group_id_by_score[win_counts[sid]]
        for sid in snack_ids
    }

    ranking = []
    for score in unique_scores:
        members = [sid for sid in snack_ids if win_counts[sid] == score]
        rng.shuffle(members)
        ranking.extend(members)

    final_rank_by_snack = {
        sid: idx + 1 for idx, sid in enumerate(ranking)
    }

    return ranking, win_counts, tie_group_id_by_snack, final_rank_by_snack


def _read_trials_for_player(player: Player, *, phase: str = "real"):
    """
    Read binary-choice data in one ranking-compatible format.

    Preferred source:
        ChoiceTrial ExtraModel rows

    Fallback source:
        choice_data_json submitted at the end of the task

    This lets the backend work even if live trial saving was not used or if
    only the final page submission is available.
    """
    session_id = _get_session_id(player)
    subject_id = _get_subject_id(player)

    phase = (phase or "real").strip().lower()
    if phase not in ("practice", "real"):
        phase = "real"

    trials = ChoiceTrial.filter(player=player)
    if trials:
        rows = []
        for trial in sorted(trials, key=lambda x: x.trial_index):
            trial_phase = (getattr(trial, "phase", None) or "real").strip().lower()
            if trial_phase not in ("practice", "real"):
                trial_phase = "real"

            if trial_phase != phase:
                continue

            rows.append(
                dict(
                    phase=trial_phase,
                    is_practice=1 if trial_phase == "practice" else 0,
                    is_timeout=1 if trial.is_timeout else 0,
                    chosen_item_id=trial.chosen_item or "",
                    left_item_id=trial.left_item_id,
                    right_item_id=trial.right_item_id,
                    rt_ms=trial.rt_ms,
                    pair_id=trial.pair_id,
                    trial_index=trial.trial_index,
                    session_id=session_id,
                    subject_id=subject_id,
                )
            )
        if rows:
            return rows

    rows = _read_binary_rows_from_player(player)
    if phase == "real":
        return [row for row in rows if int(row.get("is_practice", 0) or 0) == 0]

    return [row for row in rows if int(row.get("is_practice", 0) or 0) != 0]


# =============================================================================
# PAGES
# =============================================================================
class Consent(Page):
    @staticmethod
    def before_next_page(player: Player, timeout_happened):
        # Stage 1: always initialize backend phase state as early as possible.
        player.ensure_backend_state_initialized()


class InstructionsBDM(Page):
    pass


class WTP(Page):
    """
    WTP page.

    The frontend renders the sliders and stores all WTP rows as a JSON list
    in the single hidden field wtp_data_json.
    """
    form_model = "player"
    form_fields = ["wtp_data_json"]

    @staticmethod
    def before_next_page(player: Player, timeout_happened):
        # Stage 5: enforce strict separation of practice vs real WTP payloads.
        phase = _current_backend_phase(player)
        raw = player.field_maybe_none("wtp_data_json") or ""

        if phase == "real":
            player.current_phase = "real"
            return

        player.current_phase = "practice"
        player.wtp_data_json_practice = raw
        player.wtp_data_json = ""


class InstructionsBinary(Page):
    pass


def _repeat_block_requested(player: Player) -> bool:
    """Whether participant selected repeat at the first checkpoint."""
    return int(player.field_maybe_none("practice_repeat_count") or 0) > 0


def _show_repeat_block(player: Player) -> bool:
    """Show optional repeat-practice pages only before real starts."""
    return _repeat_block_requested(player) and not bool(player.field_maybe_none("real_started"))


def _can_request_repeat(player: Player) -> bool:
    """Whether participant can still request another repeat cycle."""
    repeat_count = int(player.field_maybe_none("practice_repeat_count") or 0)
    return repeat_count < int(C.MAX_PRACTICE_REPEAT_CYCLES)


def _apply_practice_checkpoint_decision(player: Player, *, allow_repeat: bool):
    """Apply checkpoint decision to backend state with policy enforcement."""
    player.ensure_backend_state_initialized()

    decision = (player.field_maybe_none("practice_decision") or "").strip().lower()
    if decision not in ("repeat", "begin"):
        decision = "begin"

    repeat_count = int(player.field_maybe_none("practice_repeat_count") or 0)

    # Once real starts, keep participant in real flow.
    if bool(player.field_maybe_none("real_started")):
        decision = "begin"

    if decision == "repeat" and not allow_repeat:
        decision = "begin"

    player.practice_decision = decision
    player.practice_completed = True

    if decision == "repeat":
        player.practice_repeat_count = repeat_count + 1
        player.current_phase = "practice"
        player.real_started = False
    else:
        player.current_phase = "real"
        player.real_started = True


class MyPage(Page):
    """
    Binary choice task page.

    The frontend stores the final task output in the single hidden field
    choice_data_json. The page also supports live trial saving through
    liveSend() so the backend can keep trial-level rows as the task unfolds.
    """
    form_model = "player"
    form_fields = ["choice_data_json"]

    @staticmethod
    def before_next_page(player: Player, timeout_happened):
        # Stage 4: keep practice choice payloads out of formal field.
        phase = _current_backend_phase(player)
        raw = player.field_maybe_none("choice_data_json") or ""

        if phase == "real":
            player.current_phase = "real"
            return

        player.current_phase = "practice"
        player.choice_data_json_practice = raw
        player.choice_data_json = ""

    @staticmethod
    def live_method(player: Player, data):
        """
        Save one binary-choice trial in real time.

        Expected payload example:
            {
                "type": "choice_trial",
                "trial_index": 1,
                "pair_id": "pair_01",
                "left_item_id": "snack1",
                "right_item_id": "snack4",
                "chosen_item": "snack4",
                "rt_ms": 1532,
                "is_timeout": false,
                "timestamp_utc": "2026-03-05T12:34:56Z"
            }

        Duplicate trial indices are ignored so that accidental resubmission
        does not create repeated rows.
        """
        if not isinstance(data, dict):
            return

        if data.get("type") != "choice_trial":
            return

        session_id = _get_session_id(player)
        subject_id = _get_subject_id(player)
        phase = _current_backend_phase(player)

        data_phase = str(data.get("phase", "") or "").strip().lower()
        if data_phase in ("practice", "real"):
            phase = data_phase

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
            rt_ms = float(rt_ms) if rt_ms not in (None, "") else None
        except Exception:
            rt_ms = None

        timestamp_utc = str(data.get("timestamp_utc", "") or "")

        existing = ChoiceTrial.filter(player=player, phase=phase, trial_index=trial_index)
        if existing:
            return dict(ok=True, dedup=True)

        ChoiceTrial.create(
            player=player,
            session_id=session_id,
            subject_id=subject_id,
            phase=phase,
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
    Once all six players arrive, the backend performs the full group-level
    computation:

    1) Save each participant's WTP rows in structured form.
    2) Infer each participant's ranking from binary choices.
    3) Run the allocation rule.
    4) Store each participant's final assignment.
    """

    def after_all_players_arrive(self):
        players = self.group.get_players()

        if self.group.field_maybe_none("ranking_seed") is None:
            self.group.ranking_seed = random.randint(1, 10_000_000)

        if self.group.field_maybe_none("allocation_seed") is None:
            self.group.allocation_seed = random.randint(1, 10_000_000)

        # ---------------------------------------------------------------------
        # 1) Persist WTP rows
        # ---------------------------------------------------------------------
        for player in players:
            session_id = _get_session_id(player)
            subject_id = _get_subject_id(player)

            raw_wtp_rows = _read_wtp_rows_from_player(player)
            wtp_rows = _normalize_wtp_rows(raw_wtp_rows)

            for row in wtp_rows:
                snack_id = row["snack_id"]
                bid_value = row["bid_value"]
                price_draw = row["price_draw"]

                # Avoid duplicate writes if this page is revisited.
                if WTPRow.filter(player=player, snack_id=snack_id):
                    continue

                WTPRow.create(
                    player=player,
                    session_id=session_id,
                    subject_id=subject_id,
                    snack_id=snack_id,
                    bid_value=bid_value,
                    price_draw=price_draw,
                )

        # ---------------------------------------------------------------------
        # 2) Infer rankings from binary choices
        # ---------------------------------------------------------------------
        rankings = {}

        for player in players:
            session_id = _get_session_id(player)
            subject_id = _get_subject_id(player)

            raw_rows = _read_trials_for_player(player, phase="real")
            valid_rows = _filter_valid_choice_rows(raw_rows)

            if len(valid_rows) == 0:
                player.participant.vars["real_data_warning"] = (
                    "No valid real binary trials were detected; ranking used tie-break fallback."
                )
            else:
                player.participant.vars["real_data_warning"] = ""

            # Each player gets a deterministic seed derived from the group seed.
            per_player_seed = int(self.group.ranking_seed) * 100 + int(player.id_in_group)

            ranking, win_counts, tie_group_id_by_snack, final_rank_by_snack = (
                _infer_ranking_win_count_random_ties(
                    valid_rows=valid_rows,
                    snack_ids=C.SNACK_IDS,
                    seed=per_player_seed,
                )
            )

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

            player.inferred_ranking_json = json.dumps(ranking)
            player.win_counts_json = json.dumps(win_counts)
            player.ranking_rows_json = json.dumps(ranking_rows)

            rankings[player.id_in_group] = ranking

        # ---------------------------------------------------------------------
        # 3) Run allocation
        # ---------------------------------------------------------------------
        assignment, order, meta = run_allocation(
            algo_name=C.ALLOCATION_ALGO,
            player_ids=[player.id_in_group for player in players],
            rankings=rankings,
            seed=self.group.allocation_seed,
        )

        # ---------------------------------------------------------------------
        # 4) Store allocation outputs
        # ---------------------------------------------------------------------
        for player in players:
            player.assigned_snack = assignment.get(player.id_in_group, "")

            if order is not None and player.id_in_group in order:
                player.rsd_order = order.index(player.id_in_group) + 1
            else:
                player.rsd_order = None

            try:
                ranking = json.loads(player.inferred_ranking_json or "[]")
                if player.assigned_snack in ranking:
                    player.assigned_rank_pos = ranking.index(player.assigned_snack) + 1
                else:
                    player.assigned_rank_pos = None
            except Exception:
                player.assigned_rank_pos = None


class Results(Page):
    """
    Simple result page for participant-facing feedback and debugging.
    """

    @staticmethod
    def vars_for_template(player: Player):
        try:
            ranking = json.loads(player.inferred_ranking_json or "[]")
        except Exception:
            ranking = []

        try:
            win_counts = json.loads(player.win_counts_json or "{}")
        except Exception:
            win_counts = {}

        debug_source = player.choice_data_json or ""
        real_data_warning = player.participant.vars.get("real_data_warning", "")
        config_debug_enabled = bool(player.session.config.get("show_results_debug", False))
        participant_label = str(getattr(player.participant, "label", "") or "")
        is_debug_viewer = participant_label.strip().lower().startswith("debug")
        show_results_debug = config_debug_enabled and is_debug_viewer

        return dict(
            show_results_debug=show_results_debug,
            debug_json_len=len(debug_source),
            inferred_ranking=ranking,
            win_counts=win_counts,
            assigned_snack=player.assigned_snack,
            rsd_order=player.rsd_order,
            assigned_rank_pos=player.assigned_rank_pos,
            allocation_algo=C.ALLOCATION_ALGO,
            real_data_warning=real_data_warning,
        )
    
class BannerPracticeBDM(Page):
    timeout_seconds = 2

class BannerPracticeBinary(Page):
    timeout_seconds = 2

class PracticeCheckpoint(Page):
    form_model = "player"
    form_fields = ["practice_decision"]

    @staticmethod
    def vars_for_template(player: Player):
        return dict(show_repeat_button=_can_request_repeat(player))

    @staticmethod
    def before_next_page(player: Player, timeout_happened):
        _apply_practice_checkpoint_decision(
            player,
            allow_repeat=_can_request_repeat(player),
        )


class BannerPracticeBDMRepeat(BannerPracticeBDM):
    template_name = "my_experiment/BannerPracticeBDM.html"

    @staticmethod
    def is_displayed(player: Player):
        return _show_repeat_block(player)


class WTPRepeat(WTP):
    template_name = "my_experiment/WTP.html"

    @staticmethod
    def is_displayed(player: Player):
        return _show_repeat_block(player)


class BannerPracticeBinaryRepeat(BannerPracticeBinary):
    template_name = "my_experiment/BannerPracticeBinary.html"

    @staticmethod
    def is_displayed(player: Player):
        return _show_repeat_block(player)


class MyPageRepeat(MyPage):
    template_name = "my_experiment/MyPage.html"

    @staticmethod
    def is_displayed(player: Player):
        return _show_repeat_block(player)


class PracticeCheckpointRepeat(PracticeCheckpoint):
    template_name = "my_experiment/PracticeCheckpoint.html"

    @staticmethod
    def is_displayed(player: Player):
        return _show_repeat_block(player)

    @staticmethod
    def vars_for_template(player: Player):
        return dict(show_repeat_button=_can_request_repeat(player))

    @staticmethod
    def before_next_page(player: Player, timeout_happened):
        _apply_practice_checkpoint_decision(
            player,
            allow_repeat=_can_request_repeat(player),
        )

class BannerBeginReal(Page):
    timeout_seconds = 2

    @staticmethod
    def is_displayed(player: Player):
        return bool(player.field_maybe_none("real_started"))


class WTPReal(WTP):
    template_name = "my_experiment/WTP.html"

    @staticmethod
    def is_displayed(player: Player):
        return bool(player.field_maybe_none("real_started"))


class MyPageReal(MyPage):
    template_name = "my_experiment/MyPage.html"

    @staticmethod
    def is_displayed(player: Player):
        return bool(player.field_maybe_none("real_started"))


_repeat_cycle_pages = [
    BannerPracticeBDMRepeat,
    WTPRepeat,
    BannerPracticeBinaryRepeat,
    MyPageRepeat,
    PracticeCheckpointRepeat,
]


page_sequence = [
    Consent,

    InstructionsBDM,
    BannerPracticeBDM,
    WTP,                 # WTP page runs practice BDM first if repeating/practice mode

    InstructionsBinary,
    BannerPracticeBinary,
    MyPage,              # Binary page runs practice trials first if repeating/practice mode

    PracticeCheckpoint,  # Repeat Practice / Begin Real Experiment

    *_repeat_cycle_pages * int(C.MAX_PRACTICE_REPEAT_CYCLES),

    BannerBeginReal,

    WTPReal,             # real BDM/WTP (same page, but JS in “real mode” now)
    MyPageReal,          # real binary choice (same page, “real mode” now)

    ResultsWaitPage,
    Results,
]


# =============================================================================
# CUSTOM EXPORTS
# =============================================================================
def custom_export_metadata_session(players):
    """
    Export one row per session with metadata needed to interpret the dataset.
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

    seen = set()
    for player in players:
        session_id = _get_session_id(player)
        if session_id in seen:
            continue
        seen.add(session_id)

        group = player.group
        yield [
            session_id,
            _utc_now_iso(),
            C.NAME_IN_URL,
            C.DESIGN_VERSION,
            C.PLAYERS_PER_GROUP,
            "|".join(C.SNACK_IDS),
            "win_count_random_tiebreak",
            group.ranking_seed,
            C.ALLOCATION_ALGO,
            group.allocation_seed,
        ]


def custom_export_choice_trials(players):
    """
    Export one row per binary-choice trial.

    Preferred source:
        ChoiceTrial ExtraModel rows

    Fallback source:
        choice_data_json submitted at the end of the task
    """
    yield [
        "session_id",
        "subject_id",
        "phase",
        "trial_index",
        "pair_id",
        "left_item_id",
        "right_item_id",
        "chosen_item",
        "rt_ms",
        "is_timeout",
    ]

    for player in players:
        session_id = _get_session_id(player)
        subject_id = _get_subject_id(player)

        trials = ChoiceTrial.filter(player=player)
        exported_keys = set()

        if trials:
            for trial in sorted(trials, key=lambda x: x.trial_index):
                trial_phase = (getattr(trial, "phase", None) or "real").strip().lower()
                if trial_phase not in ("practice", "real"):
                    trial_phase = "real"

                key = (
                    trial_phase,
                    trial.trial_index,
                    trial.pair_id,
                    trial.left_item_id,
                    trial.right_item_id,
                    trial.chosen_item,
                    trial.rt_ms,
                    1 if trial.is_timeout else 0,
                )
                if key in exported_keys:
                    continue
                exported_keys.add(key)

                yield [
                    session_id,
                    subject_id,
                    trial_phase,
                    trial.trial_index,
                    trial.pair_id,
                    trial.left_item_id,
                    trial.right_item_id,
                    trial.chosen_item,
                    trial.rt_ms,
                    1 if trial.is_timeout else 0,
                ]

        # Include fallback JSON rows for any phase missing from live-save table.
        # This keeps exports complete even if liveSend was unavailable.
        has_practice_live = any(
            (getattr(t, "phase", None) or "real").strip().lower() == "practice"
            for t in trials
        )
        has_real_live = any(
            (getattr(t, "phase", None) or "real").strip().lower() == "real"
            for t in trials
        )

        fallback_phase_rows = []
        if (not trials) or (not has_practice_live):
            fallback_phase_rows.extend(
                ("practice", row) for row in _read_binary_rows_from_player_practice(player)
            )
        if (not trials) or (not has_real_live):
            fallback_phase_rows.extend(
                ("real", row) for row in _read_binary_rows_from_player(player)
            )

        for phase_label, row in fallback_phase_rows:
            trial_index = row.get("trial_index", "")
            pair_id = row.get("pair_id", "")
            left_item_id = row.get("left_item_id", "")
            right_item_id = row.get("right_item_id", "")
            chosen_item = row.get("chosen_item_id", "")
            rt_ms = row.get("rt_ms", "")
            is_timeout = row.get("is_timeout", "")

            key = (
                phase_label,
                trial_index,
                pair_id,
                left_item_id,
                right_item_id,
                chosen_item,
                rt_ms,
                is_timeout,
            )
            if key in exported_keys:
                continue
            exported_keys.add(key)

            yield [
                session_id,
                subject_id,
                phase_label,
                trial_index,
                pair_id,
                left_item_id,
                right_item_id,
                chosen_item,
                rt_ms,
                is_timeout,
            ]


def custom_export_ranking(players):
    """
    Export one row per snack per participant for the inferred ranking.
    """
    yield [
        "session_id",
        "subject_id",
        "snack_id",
        "win_count",
        "tie_group_id",
        "final_rank",
    ]

    for player in players:
        rows = _parse_json_list(player.ranking_rows_json)
        for row in rows:
            yield [
                row.get("session_id", _get_session_id(player)),
                row.get("subject_id", _get_subject_id(player)),
                row.get("snack_id", ""),
                row.get("win_count", ""),
                row.get("tie_group_id", ""),
                row.get("final_rank", ""),
            ]


def custom_export_wtp(players):
    """
    Export one row per snack per participant for the WTP task.

    Preferred source:
        WTPRow ExtraModel rows

    Fallback source:
        wtp_data_json submitted by the frontend
    """
    yield ["session_id", "subject_id", "phase", "snack_id", "bid_value", "price_draw"]

    for player in players:
        session_id = _get_session_id(player)
        subject_id = _get_subject_id(player)

        rows = WTPRow.filter(player=player)
        exported_real = False

        if rows:
            for row in rows:
                exported_real = True
                yield [
                    session_id,
                    subject_id,
                    "real",
                    row.snack_id,
                    row.bid_value,
                    row.price_draw,
                ]

        if not exported_real:
            raw_rows = _read_wtp_rows_from_player(player)
            normalized_rows = _normalize_wtp_rows(raw_rows)

            for row in normalized_rows:
                yield [
                    session_id,
                    subject_id,
                    "real",
                    row.get("snack_id", ""),
                    row.get("bid_value", ""),
                    row.get("price_draw", ""),
                ]

        practice_raw_rows = _read_wtp_rows_from_player_practice(player)
        practice_normalized_rows = _normalize_wtp_rows(practice_raw_rows)
        for row in practice_normalized_rows:
            yield [
                session_id,
                subject_id,
                "practice",
                row.get("snack_id", ""),
                row.get("bid_value", ""),
                row.get("price_draw", ""),
            ]


def custom_export_matching_rsd(players):
    """
    Export the final RSD assignment for each participant.
    """
    yield [
        "session_id",
        "subject_id",
        "serial_position",
        "assigned_snack_id",
        "assigned_rank_pos",
    ]

    for player in players:
        yield [
            _get_session_id(player),
            _get_subject_id(player),
            player.rsd_order,
            player.assigned_snack,
            player.assigned_rank_pos,
        ]


def custom_export_matching_da(players):
    """
    Placeholder export for a future deferred acceptance implementation.

    The current app uses RSD, but keeping this export shape makes it easier
    to add another allocation rule later without redesigning the export API.
    """
    yield [
        "session_id",
        "subject_id",
        "assigned_snack_id",
        "assigned_rank_pos",
        "consistency_index",
    ]

    for player in players:
        yield [
            _get_session_id(player),
            _get_subject_id(player),
            "",
            "",
            "",
        ]
