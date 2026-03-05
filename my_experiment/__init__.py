from otree.api import *


doc = """
Your app description
"""


class C(BaseConstants):
    NAME_IN_URL = 'my_experiment'
    PLAYERS_PER_GROUP = None
    NUM_ROUNDS = 1


class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    pass


class Player(BasePlayer):
    wtp_data_json = models.LongStringField(blank=True)
    choice_data_json = models.LongStringField(blank=True)


# PAGES
class Consent(Page):
    pass

class InstructionsBDM(Page):
    pass

class WTP(Page):
    form_model = 'player'
    form_fields = ['wtp_data_json']

class InstructionsBinary(Page):
    pass

class MyPage(Page):
    form_model = 'player'
    form_fields = ['choice_data_json']


class ResultsWaitPage(WaitPage):
    pass


class Results(Page):
    pass


page_sequence = [
    Consent,
    InstructionsBDM,
    WTP,
    InstructionsBinary,
    MyPage,
    ResultsWaitPage,
    Results,
]
