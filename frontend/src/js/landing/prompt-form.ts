/**
 * Landing hero prompt form (index.pug `form#prompt`).
 * @remarks The form is a plain GET to /studio (`provider` + `prompt`), so it
 *   works without JS. This module only adds the per-mode placeholder and
 *   example chips, the CAD availability gate, and `a[href="#prompt"]` links
 *   that focus the input.
 */

export type LandingProvider = "tripo3d" | "cad";

export const PROMPT_MODES: Record<LandingProvider, { placeholder: string; examples: string[] }> = {
  tripo3d: {
    placeholder: "Describe a character or prop…",
    examples: ["Low-poly fox", "Cowboy mascot", "Sci-fi crate"],
  },
  cad: {
    placeholder: "Describe a part…",
    examples: ["M3 mounting bracket, 40 mm", "Phone stand, 70°", "Gridfinity bin 2×3"],
  },
};

export interface PromptFormOptions {
  /** Resolves false when the deployment cannot serve CAD (config.cadGeneration === false). */
  cadAvailable: Promise<boolean>;
}

export function initPromptForm(form: HTMLFormElement, { cadAvailable }: PromptFormOptions): void {
  const input = form.querySelector<HTMLInputElement>('input[name="prompt"]');
  if (!input) return;
  const chips = document.getElementById("promptChips");

  const radio = (value: LandingProvider) =>
    form.querySelector<HTMLInputElement>(`input[name="provider"][value="${value}"]`);
  const mode = (): LandingProvider =>
    form.querySelector<HTMLInputElement>('input[name="provider"]:checked')?.value === "cad" ? "cad" : "tripo3d";

  const render = () => {
    const { placeholder, examples } = PROMPT_MODES[mode()];
    input.placeholder = placeholder;
    chips?.replaceChildren(
      ...examples.map((text) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prompt-chip";
        chip.textContent = text;
        return chip;
      }),
    );
  };

  form.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).name === "provider") render();
  });

  chips?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest(".prompt-chip");
    if (!chip) return;
    input.value = chip.textContent ?? "";
    input.focus();
  });

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href="#prompt"]')) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      form.scrollIntoView?.({ block: "center" });
      input.focus({ preventScroll: true });
    });
  }

  void cadAvailable.then((available) => {
    if (available) return;
    radio("cad")?.closest("label")?.remove();
    const fallback = radio("tripo3d");
    if (fallback) fallback.checked = true;
    const switcher = form.querySelector<HTMLElement>(".prompt-mode");
    if (switcher) switcher.hidden = true;
    render();
  });

  render();
}
