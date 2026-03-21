class InstructionCarousel {
  constructor(root) {
    this.root = root;
    this.slides = Array.from(root.querySelectorAll(".instruction-slide"));
    this.prevBtn = root.querySelector(".instruction-prev");
    this.nextBtn = root.querySelector(".instruction-next");
    this.indicator = root.querySelector(".instruction-indicator");
    const nextButtonId = root.dataset.nextButtonId || "nextBtn";
    this.nextPageBtn = document.getElementById(nextButtonId);
    this.index = 0;
    this.isAnimating = false;
    this.fadeMs = 150;

    this.prevBtn?.addEventListener("click", () => this.go(-1));
    this.nextBtn?.addEventListener("click", () => this.go(1));
    this.update();
  }

  go(delta) {
    const nextIndex = Math.min(Math.max(this.index + delta, 0), this.slides.length - 1);
    if (nextIndex === this.index) return;
    if (this.isAnimating) return;
    this.transitionTo(nextIndex);
  }

  transitionTo(nextIndex) {
    const currentSlide = this.slides[this.index];
    const nextSlide = this.slides[nextIndex];
    if (!currentSlide || !nextSlide) return;

    this.isAnimating = true;

    currentSlide.classList.add("leaving");

    setTimeout(() => {
      currentSlide.classList.remove("leaving", "active");

      this.index = nextIndex;
      nextSlide.classList.add("active", "entering");
      this.updateNavState();

      setTimeout(() => {
        nextSlide.classList.remove("entering");
        this.isAnimating = false;
      }, this.fadeMs);
    }, this.fadeMs);
  }

  update() {
    this.slides.forEach((slide, idx) => {
      slide.classList.toggle("active", idx === this.index);
      if (idx !== this.index) {
        slide.classList.remove("leaving", "entering");
      }
    });
    this.updateNavState();
  }

  updateNavState() {
    const total = this.slides.length;
    if (this.indicator) {
      this.indicator.textContent = `Slide ${this.index + 1} of ${total}`;
    }
    if (this.prevBtn) this.prevBtn.disabled = this.index === 0;
    if (this.nextBtn) this.nextBtn.disabled = this.index === total - 1;
    if (this.nextPageBtn) this.nextPageBtn.disabled = this.index !== total - 1;
  }
}

function initInstructionCarousels() {
  document.body.classList.add("instruction-body");
  document.querySelectorAll(".instruction-carousel").forEach((root) => {
    new InstructionCarousel(root);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initInstructionCarousels);
} else {
  initInstructionCarousels();
}
