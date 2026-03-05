"""
Backend logic for the snack allocation experiment.

This app collects binary choice data from the frontend JavaScript task.
Trial-level data are transmitted to the backend as a serialized JSON string
stored in Player.binary_rows_json.

The backend will later:
1. reconstruct pairwise preferences
2. infer a strict ranking over snacks
3. compute response-time based statistics
4. run allocation mechanisms (Random Serial Dictatorship, later Deferred Acceptance)

This design keeps the frontend responsible for stimulus presentation and
reaction-time recording, while the backend handles preference inference
and allocation algorithms.
"""

from otree.api import *

import random
from .allocation.rsd import run_rsd


doc = """
Your app description
"""


class C(BaseConstants):
    NAME_IN_URL = 'my_experiment'
    PLAYERS_PER_GROUP = 6
    NUM_ROUNDS = 1


class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    pass


class Player(BasePlayer):

    # Store all binary-choice trials from the frontend as a JSON string.
    # The frontend (task.js) collects trial-level data in an array called `rows`.
    # At the end of the task, we serialize this array and send it through a hidden
    # form field to the backend. This field allows the backend to access the full
    # behavioral dataset for each participant (choices, RTs, stimulus IDs, etc.).
    #
    # This data will later be used to:
    #   1) reconstruct pairwise preferences
    #   2) infer a strict ranking over snacks
    #   3) compute response-time based statistics
    #   4) run the allocation algorithms that determine which snack the participant receives at the end of the experiment
    binary_rows_json = models.LongStringField(blank=True)

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

    # This function runs once all players in the group arrive.
    # Here we execute the allocation algorithm.
    def after_all_players_arrive(self):

        players = self.group.get_players()

        # For now we use a placeholder ranking.
        # Later we will infer rankings from binary_rows_json.
        snacks = ["HotSauce", "Saltines", "Chips", "Oreos", "Carrots", "Grapes"]

        rankings = {}

        for p in players:
            rankings[p.id_in_group] = snacks.copy()

        # Run RSD allocation
        assignment, order = run_rsd(
            player_ids=[p.id_in_group for p in players],
            rankings=rankings,
        )

        # Store results in Player fields
        for p in players:
            p.assigned_snack = assignment[p.id_in_group]
            p.rsd_order = order.index(p.id_in_group) + 1


class Results(Page):

    # Pass variables to the template so we can display debug info and allocation results.
    def vars_for_template(self):

        return dict(
            debug_json_len=len(self.binary_rows_json or ""),
            assigned_snack=self.assigned_snack,
            rsd_order=self.rsd_order,
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
