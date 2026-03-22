export const EXPERIMENT = {
  MAX_RESPONSE_WINDOW_MS: 12000,
  FIXATION_MS: 500,
  ITI_MS: 500,
  REPEAT_BINARY_CHOICES: 1,
  KEY_LEFT: "ArrowLeft",
  KEY_RIGHT: "ArrowRight",
  PRACTICE_BINARY_TRIALS: 3,
  PRACTICE_BDM_TRIALS: 3,
};

export const BDM = {
  ENDOWMENT: 1.00,
  PRICE_STEP: 0.05,
  PRACTICE_TRIALS: 3,
};

export const SNACKS = [
  { id: "snack1", label: "A Teaspoon of Ketchup", img: "/static/my_experiment/assets/snacks/snack1.png" },
  { id: "snack2", label: "One Oreo", img: "/static/my_experiment/assets/snacks/snack2.jpg" },
  { id: "snack3", label: "One Potato Chip", img: "/static/my_experiment/assets/snacks/snack3.jpg" },
  { id: "snack4", label: "One Saltine Cracker", img: "/static/my_experiment/assets/snacks/snack4.jpg" },
  { id: "snack5", label: "One Grape", img: "/static/my_experiment/assets/snacks/snack5.jpg" },
  { id: "snack6", label: "One Baby Carrot", img: "/static/my_experiment/assets/snacks/snack6.jpg" },
];

export const PRACTICE_SNACKS = [
  {
    id: "practice_snack1",
    label: "Mini Pretzel Twist",
    img: "/static/my_experiment/assets/snacks/practice_snack1.png",
  },
  {
    id: "practice_snack2",
    label: "One Gummy Bear",
    img: "/static/my_experiment/assets/snacks/practice_snack2.png",
  },
  {
    id: "practice_snack3",
    label: "One Almond",
    img: "/static/my_experiment/assets/snacks/practice_snack3.png",
  },
];