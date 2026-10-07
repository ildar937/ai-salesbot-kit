# AI Sales-Bot Kit

A small, rule-based engine for a website chat assistant that qualifies a visitor, matches them to a product from a catalog, handles objections, captures a lead, and hands off to a human — built from a real build-brief in under a day.

**[Live demo →](https://claude.ai/artifact/372MXKgz2aWxzunGG9vhdr)**

## What's inside

- `ai-sales-demo/catalog.json` — the product catalog (versioned, so a price change is traceable)
- `ai-sales-demo/engine.js` — the router: a conversation state machine (new → discovery → offer → consent_pending → lead_draft → human_pending → closed), deterministic catalog matching (never invents a price), idempotent lead creation, basic prompt-injection resistance
- `ai-sales-demo/tests.js` — 14 acceptance scenarios (normal flow, price-first question, missing price, conflicting price sources, unsuitable product, unauthorized discount request, declined contact, human handoff, duplicate lead submission, delivery failure, rule-override attempt, cross-conversation access, model timeout, stop button) — run with `node tests.js`
- `ai-sales-demo/skills/` — six written skill specs (discovery, product-match, objections, lead-capture, human-handoff, quality-check) meant to become system-prompt instructions once a real LLM is wired in
- `ai-sales-demo/index.html` — the self-contained demo page (same logic, browser UI)

## Current state

This is a rule-based demo, not a production bot: intent detection is pattern-matching, not a real language model call. It's built to show the conversation logic, safety rails, and test coverage clearly enough that wiring in a real provider (OpenAI, Anthropic, etc., server-side key only) is a drop-in replacement for detectIntent() — not a rewrite of the state machine or the skills.

## Use it

Swap the catalog for your own products, point the skill functions at a real model using the `ai-sales-demo/skills/*/SKILL.md` files as system prompts, and embed `index.html`'s script (or `engine.js` directly) in your own site.

## License

MIT — use it, fork it, ship it.

## More from the same build

Free SEO/web utilities (uptime, SEO audit, meta-tag/robots.txt/sitemap generators, speed check, and more): see [free-web-tools](https://github.com/ildar937/free-web-tools) — built the same way, for the same kind of small-business sites.
