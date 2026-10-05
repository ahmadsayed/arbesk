/**
 * Landing "The world is 4D." demo (index.pug `#versionDemo`): the Howdy model
 * with a v1–v4 version rail. Babylon loads from the CDN only when the demo
 * scrolls into view; the render loop pauses off-screen. Until the viewer is
 * ready (or if it fails / JS is off) the static render stays visible.
 */

// Babylon is loaded from the CDN as a global on this page (no app bundle).
declare const BABYLON: any;

const BJS_CORE = "https://cdn.jsdelivr.net/npm/babylonjs@9.12.0/babylon.min.js";
const BJS_LOADERS = "https://cdn.babylonjs.com/v9.12.0/loaders/babylonjs.loaders.min.js";

/** v4 repaint: glTF material name → new colour. */
const REPAINT: Record<string, string> = { hat: "#1f6f78", scarf: "#d9a441" };

export const DEMO_VERSIONS = [
  { tag: "v1", label: "Generated", note: "Untextured mesh from a prompt" },
  { tag: "v2", label: "Painted", note: "Colours applied" },
  { tag: "v3", label: "Resized", note: "Scaled ×1.2 by an editor" },
  { tag: "v4", label: "Repainted", note: "New hat and scarf. Latest" },
];

/** Builds the rail buttons; keeps rail + caption in sync. Returns `select(i)`. */
export function wireVersionRail(
  rail: HTMLElement,
  caption: HTMLElement | null,
  onSelect: (i: number) => void,
): (i: number) => void {
  rail.replaceChildren(
    ...DEMO_VERSIONS.map((v, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(i);
      const tag = document.createElement("span");
      tag.className = "rail-tag";
      tag.textContent = v.tag;
      button.append(tag, v.label);
      return button;
    }),
  );

  const select = (i: number) => {
    rail.querySelectorAll("button").forEach((button, k) => {
      button.classList.toggle("is-current", k === i);
      button.classList.toggle("is-past", k < i);
      button.setAttribute("aria-pressed", String(k === i));
    });
    if (caption) caption.textContent = `${DEMO_VERSIONS[i].tag} — ${DEMO_VERSIONS[i].note}`;
    onSelect(i);
  };

  rail.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
    if (button) select(Number(button.dataset.index));
  });

  select(DEMO_VERSIONS.length - 1);
  return select;
}

interface DemoViewer {
  setVersion(i: number): void;
  start(): void;
  stop(): void;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function mountDemoViewer(canvas: HTMLCanvasElement, reduceMotion: boolean): Promise<DemoViewer> {
  await loadScript(BJS_CORE);
  await loadScript(BJS_LOADERS);

  const engine = new BABYLON.Engine(canvas, true, { alpha: true, antialias: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

  const result = await BABYLON.SceneLoader.ImportMeshAsync("", "/models/", "howdy.glb", scene);
  result.meshes.forEach((m: any) => m.computeWorldMatrix(true));
  const parts = result.meshes.filter((m: any) => m.getTotalVertices?.() > 0);

  let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of parts) {
    const box = m.getBoundingInfo().boundingBox;
    min = BABYLON.Vector3.Minimize(min, box.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, box.maximumWorld);
  }
  const center = min.add(max).scale(0.5);
  const radius = max.subtract(min).length() / 2 || 1;

  // Pivot on the feet so the v3 resize grows upward, not into the floor.
  const pivot = new BABYLON.TransformNode("pivot", scene);
  pivot.position = new BABYLON.Vector3(center.x, min.y, center.z);
  result.meshes[0].setParent(pivot);

  const target = center.add(new BABYLON.Vector3(0, radius * 0.12, 0));
  const camera = new BABYLON.ArcRotateCamera("cam", Math.PI / 4, Math.PI / 2.5, radius * 5, target, scene);
  camera.fov = 0.45;
  camera.lowerBetaLimit = 0.7;
  camera.upperBetaLimit = Math.PI / 1.95;
  camera.panningSensibility = 0;
  // No wheel zoom: the wheel must keep scrolling the page.
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.attachControl(canvas, true);

  new BABYLON.HemisphericLight("key", new BABYLON.Vector3(0.3, 1, 0.2), scene).intensity = 0.9;
  const rim = new BABYLON.DirectionalLight("rim", new BABYLON.Vector3(-0.6, -0.2, 1), scene);
  rim.intensity = 1.2;
  rim.diffuse = new BABYLON.Color3(0.94, 0.75, 0.5);

  const clay = new BABYLON.PBRMaterial("clay", scene);
  clay.albedoColor = new BABYLON.Color3(0.62, 0.62, 0.6);
  clay.metallic = 0;
  clay.roughness = 0.85;
  const originals = parts.map((m: any) => m.material);
  const repainted = originals.map((mat: any) => {
    const hex = mat && REPAINT[mat.name];
    if (!hex) return mat;
    const copy = mat.clone(`${mat.name}-v4`);
    copy.albedoColor = BABYLON.Color3.FromHexString(hex).toLinearSpace();
    return copy;
  });

  let targetScale = 1;
  let spinning = !reduceMotion;
  canvas.addEventListener("pointerdown", () => {
    spinning = false;
  });

  const render = () => {
    engine.resize();
    if (spinning) camera.alpha += 0.003;
    const s = pivot.scaling.x + (targetScale - pivot.scaling.x) * (reduceMotion ? 1 : 0.12);
    pivot.scaling.setAll(s);
    scene.render();
  };

  return {
    setVersion(i) {
      parts.forEach((m: any, k: number) => {
        m.material = i === 0 ? clay : i === 3 ? repainted[k] : originals[k];
      });
      targetScale = i >= 2 ? 1.2 : 1;
    },
    start() {
      engine.stopRenderLoop();
      engine.runRenderLoop(render);
    },
    stop() {
      engine.stopRenderLoop();
    },
  };
}

export function initVersionDemo(figure: HTMLElement): void {
  const canvas = figure.querySelector("canvas");
  const rail = document.getElementById("versionRail");
  if (!canvas || !rail) return;

  let viewer: DemoViewer | null = null;
  let current = DEMO_VERSIONS.length - 1;
  wireVersionRail(rail, document.getElementById("versionCaption"), (i) => {
    current = i;
    viewer?.setVersion(i);
  });

  if (!("IntersectionObserver" in window)) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let booting = false;

  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          viewer?.stop();
        } else if (viewer) {
          viewer.start();
        } else if (!booting) {
          booting = true;
          mountDemoViewer(canvas, reduceMotion)
            .then((v) => {
              viewer = v;
              v.setVersion(current);
              v.start();
              figure.classList.add("viewer-ready");
            })
            .catch(() => figure.classList.add("viewer-failed"));
        }
      }
    },
    { threshold: 0.2 },
  ).observe(figure);
}
