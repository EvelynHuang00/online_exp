"""
Backend logic for the snack allocation experiment.

Frontend (JavaScript) handles stimulus presentation and RT measurement.
Backend (oTree) stores trial data, infers each participant's snack ranking,
and runs an allocation algorithm (RSD now; DA later).

Key idea:
- Keep inference + allocation modular so we can swap algorithms without
  rewriting page flow.
"""
import json
import random
from otree.api import *

from .inference.ranking import (
    parse_binary_rows,
    filter_main_non_timeout,
    infer_ranking_by_win_count,
)
from .allocation import run_allocation


doc = "Snack allocation experiment (backend)."


class C(BaseConstants):
    NAME_IN_URL = "my_experiment"
    PLAYERS_PER_GROUP = 6
    NUM_ROUNDS = 1

    # Switch allocation algorithm here:
    # "rsd" now; later we can add "da" without rewriting page logic.
    ALLOCATION_ALGO = "rsd"


class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    # Seed used to make allocation reproducible within a session.
    allocation_seed = models.IntegerField(blank=True)


class Player(BasePlayer):

    # Raw trial-level data from frontend JS (serialized JSON string).
    binary_rows_json = models.LongStringField(blank=True)

    # Inferred strict ranking over snacks, stored as JSON string.
    # Example: ["snack4","snack2","snack6","snack1","snack3","snack5"]
    inferred_ranking_json = models.LongStringField(blank=True)

    # Debug: win counts per snack, stored as JSON string.
    # Example: {"snack1": 3, "snack2": 7, ...}
    win_counts_json = models.LongStringField(blank=True)

    # Final snack assigned by the allocation mechanism (RSD for now).
    assigned_snack = models.StringField(blank=True)

    # Position in the RSD order (1 = first dictator).
    rsd_order = models.IntegerField(blank=True)


# PAGES
class Consent(Page):
    pass

class InstructionsBDM(Page):
    pass

class WTP(Page):
    pass

class InstructionsBinary(Page):
    pass

class MyPage(Page):

    # We enable form submission on this page so that the frontend can send
    # trial data to the backend when the participant clicks "Next".
    form_model = 'player'

    # The hidden form field defined in the HTML template will populate this
    # Player field with the serialized JSON string containing all trial rows.
    form_fields = ['binary_rows_json']


import random
from .allocation.rsd import run_rsd


class ResultsWaitPage(WaitPage):
    """
    WaitPage that blocks until all 6 participants finish the binary task.

    After all players arrive, we run the backend pipeline ONCE at the group level:
    1) parse each player's submitted trial JSON
    2) infer each player's strict snack ranking (and win counts)
    3) run allocation (RSD now; DA later via the same interface)
    4) write allocation outputs back to each Player for the Results page
    """

    def after_all_players_arrive(self):
        players = self.group.get_players()

        # ------------------------------------------------------------
        # 1) Infer each player's ranking from their stored JSON.
        # ------------------------------------------------------------
        rankings = {}
        for p in players:
            raw_rows = parse_binary_rows(p.binary_rows_json)
            main_rows = filter_main_non_timeout(raw_rows)

            ranking, win_counts = infer_ranking_by_win_count(main_rows)

            # Store inferred outputs for later inspection/export/debug.
            p.inferred_ranking_json = json.dumps(ranking)
            p.win_counts_json = json.dumps(win_counts)

            rankings[p.id_in_group] = ranking

        # ------------------------------------------------------------
        # 2) Run allocation (RSD now; DA later).
        #    IMPORTANT: In oTree, reading a NULL field directly can raise an error.
        #    Use field_maybe_none() to safely check whether a value exists.
        # ------------------------------------------------------------
        if self.group.field_maybe_none("allocation_seed") is None:
            self.group.allocation_seed = random.randint(1, 10_000_000)

        assignment, order, meta = run_allocation(
            algo_name=C.ALLOCATION_ALGO,
            player_ids=[p.id_in_group for p in players],
            rankings=rankings,
            seed=self.group.allocation_seed,
        )

        # ------------------------------------------------------------
        # 3) Store allocation results back to each player.
        # ------------------------------------------------------------
        for p in players:
            p.assigned_snack = assignment[p.id_in_group]

            # For non-RSD algorithms, "order" may be None.
            # For RSD, "order" should be a list like [3,1,6,2,5,4]
            if order is not None and p.id_in_group in order:
                p.rsd_order = order.index(p.id_in_group) + 1
            else:
                p.rsd_order = None


class Results(Page):
    # Show debug + results for validation (remove debug later).
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
            debug_json_len=len(self.binary_rows_json or ""),
            inferred_ranking=ranking,
            win_counts=win_counts,
            assigned_snack=self.assigned_snack,
            rsd_order=self.rsd_order,
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
