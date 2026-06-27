/**
 * Arbesk Diagram Engine
 * Shared SVG connection + particle + highlight logic for docs/diagrams/.
 */

/* global window document */

window.DiagramEngine = (function () {
  'use strict';

  const defaults = {
    diagramId: 'diagram',
    svgId: 'svg',
    stepInterval: 1400,
    particleDuration: 2200,
    particleJitter: 500,
    arrowGap: 7
  };

  function injectKeyframes() {
    if (document.getElementById('diagram-engine-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'diagram-engine-keyframes';
    style.textContent = `
      @keyframes diagram-particle-move {
        0% { offset-distance: 0%; opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { offset-distance: 100%; opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildPath(r1, r2, containerRect, gap) {
    const sourceCenterY = r1.top + r1.height / 2 - containerRect.top;
    const targetCenterY = r2.top + r2.height / 2 - containerRect.top;
    const startX = r1.right - containerRect.left;
    const endX = r2.left - containerRect.left;

    // Offset connection points toward the connected node so forks and merges
    // fan out instead of overlapping at a single source/target point.
    const deltaY = targetCenterY - sourceCenterY;
    const sourceOffset = Math.sign(deltaY) * Math.min(Math.abs(deltaY) * 0.5, r1.height * 0.35);
    const targetOffset = -Math.sign(deltaY) * Math.min(Math.abs(deltaY) * 0.5, r2.height * 0.35);

    const y1 = sourceCenterY + sourceOffset;
    const y2 = targetCenterY + targetOffset;

    if (Math.abs(y2 - y1) < 2) {
      return `M ${startX} ${y1} L ${endX - gap} ${y2}`;
    }

    const midX = (startX + endX) / 2;
    return `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${endX - gap} ${y2}`;
  }

  function connect(svg, diagram, fromSelector, toSelector, color, markerId, options) {
    const from = document.querySelector(fromSelector);
    const to = document.querySelector(toSelector);
    if (!from || !to) return;

    const containerRect = diagram.getBoundingClientRect();
    const d = buildPath(
      from.getBoundingClientRect(),
      to.getBoundingClientRect(),
      containerRect,
      options.arrowGap
    );

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('marker-end', `url(#${markerId})`);
    if (color) path.style.stroke = color;
    path.dataset.from = fromSelector;
    path.dataset.to = toSelector;
    svg.appendChild(path);

    const particle = document.createElement('div');
    particle.className = 'particle';
    const particleColor = color || 'var(--accent-bg)';
    particle.style.background = particleColor;
    particle.style.boxShadow = `0 0 8px ${particleColor}`;
    particle.style.offsetPath = `path('${d.replace(/'/g, "\\'")}')`;
    const duration = options.particleDuration + Math.random() * options.particleJitter;
    particle.style.animation = `diagram-particle-move ${duration}ms linear infinite`;
    particle.style.animationDelay = `${Math.random() * 1500}ms`;
    diagram.appendChild(particle);
  }

  function draw(svg, diagram, connections, options) {
    svg.querySelectorAll('path').forEach(p => p.remove());
    diagram.querySelectorAll('.particle').forEach(p => p.remove());

    connections.forEach(({ from, to, color, marker }) => {
      connect(svg, diagram, from, to, color, marker || 'arrowhead', options);
    });
  }

  function highlightStep(svg, nodes, stepGroups, stepIndex) {
    nodes.forEach(n => n.classList.remove('active'));
    svg.querySelectorAll('path').forEach(p => p.classList.remove('active'));
    svg.classList.remove('active-marker');

    const selectors = stepGroups[stepIndex];
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.classList.add('active');
    });

    selectors.forEach(sel => {
      svg.querySelectorAll(`path[data-from="${sel}"]`).forEach(p => p.classList.add('active'));
    });

    if (selectors.length > 0) svg.classList.add('active-marker');
  }

  function init(config) {
    const options = { ...defaults, ...config };
    const diagram = document.getElementById(options.diagramId);
    const svg = document.getElementById(options.svgId);
    const nodes = Array.from(document.querySelectorAll('.node'));

    if (!diagram || !svg) {
      console.error('[DiagramEngine] diagram or svg element not found');
      return;
    }

    injectKeyframes();

    function render() {
      draw(svg, diagram, options.connections, options);
    }

    let stepIndex = 0;
    function step() {
      highlightStep(svg, nodes, options.steps, stepIndex);
      stepIndex = (stepIndex + 1) % options.steps.length;
    }

    window.addEventListener('load', render);
    window.addEventListener('resize', render);

    setTimeout(() => {
      step();
      setInterval(step, options.stepInterval);
    }, 200);
  }

  return { init };
})();
