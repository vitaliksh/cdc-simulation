# Project Instructions (interactive article site)

## Goal
We build a single website with long-form articles + interactive JavaScript demos,
in the style of ciechanow.ski: clear explanations, smooth visuals, and high performance.

## Non‑negotiable rules
- Do not change existing behavior unless I explicitly ask.
- Do not “refactor” or “optimize” unrelated code.
- If a change might break something, propose the smallest safe patch.
- When unsure, ask one short question before changing code.

## Writing style (articles)
- The main idea - keep reader staying on the web page, not boring him.
- Use simple and clear language. Short sentences. No marketing tone.
- Explain concepts step-by-step.
- Prefer diagrams and interactive demos over long theory.
- Each article must have:
  1) Short goal paragraph (2–4 sentences)
  2) Key idea bullets (3–7 bullets)
  3) Interactive demo section(s)
  4) Summary + “what to try next”

## Interactive demos (JavaScript)
- Prefer Canvas or SVG (choose the simplest that works).
- Keep animations smooth (aim for 60 fps).
- Avoid heavy frameworks unless needed.
- No external libraries unless I ask.
- Provide controls: play/pause, step, speed, reset.
- Make state deterministic (same inputs => same output).

## Performance
- Keep bundle small.
- Avoid expensive per-frame allocations.
- Use requestAnimationFrame for animation loops.
- Keep assets compressed and lazy-loaded when possible.

## Accessibility and UX
- Must work on desktop and mobile.
- Controls must be usable with keyboard.
- Good contrast, readable fonts, clear labels.

## Project structure
- /index.html             blog homepage
- /shared/css/            shared CSS (base.css, demo-controls.css)
- /shared/js/             shared JS utilities (future use)
- /posts/<topic>/         one folder per article
- /posts/<topic>/index.html   article page (text + embedded demos)
- /posts/<topic>/style.css    article-specific styling
- /posts/<topic>/demos/       demo HTML + JS files (one pair per demo)

## “Done” means
- The site builds successfully.
- The demo works as described.
- No unintended behavior changes.
- You briefly describe what changed and where.