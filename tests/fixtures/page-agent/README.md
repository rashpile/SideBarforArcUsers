# Page agent fixture pages

Two local pages for checking the page agent by hand. They copy the layout of the demo page, which sits
behind a login: a 56 px icon rail on the left, a content column capped at `max-width: 1260px`, a 16:9
player iframe, a row of playback buttons and toggles under it, and notes below.

- `video-plain.html` sizes the player with CSS (`width: 100%`, `aspect-ratio: 16 / 9`).
- `video-js-sizing.html` has a script that writes inline `width` and `height` on the iframe on load and
  on window resize. Widening the column alone doesn't widen the player here, because the script doesn't
  run again. The agent's CSS has to beat the inline styles.

The player is a `srcdoc` iframe, so the pages load nothing from the network. It prints its own size and
aspect ratio in the top left corner, which makes the report's numbers easy to compare.

Vite builds only `index.html`, `src/background.ts` and `src/switcherOverlay.ts` and copies `public/`, so
these files never reach `dist/`.

## Setup

1. Run `make test-build` in this worktree and reload the extension at `chrome://extensions`.
2. In Settings, fill in the AI endpoint, key and a model that supports tool calls. Turn on "Model
   accepts images" if the model takes images.
3. Serve this directory:

   ```sh
   cd tests/fixtures/page-agent
   python3 -m http.server
   ```

4. Open `http://localhost:8000/video-plain.html` or `http://localhost:8000/video-js-sizing.html`. Page
   access (`http://*/*`) covers this http origin. If the drawer says it's missing, click **Grant page
   access**. With images on, **Grant screenshot access** adds screenshots; runs work without them.

Use a window wider than 1316 px (rail plus column), or the column cap never shows.

## What to type

Run these steps on both pages.

1. Open the drawer with the Sparkles button in the toolbar and type
   `make the video player full page width`.
2. The agent reads the outline, takes a screenshot if images are on, and shows its conditions before it
   changes anything. Expect something like: iframe width equals the content area width (±2 px), aspect
   ratio 16:9 (±1%), controls under the video visible and not overlapped.
3. It applies CSS and inspects. The 1260 px column caps the width, so it widens the column and inspects
   again. "show steps" lists every tool call and the CSS.
4. The report marks every condition met and gives numbers, e.g. "iframe 1816px, content area 1816px,
   16:9". Full page width runs from the rail's right edge to the window's right edge. The rail stays.
   The player's own readout should agree with the report.
5. In the same chat, type `fit it into the screen height`. It passes when the video's bottom edge is
   inside the viewport, the ratio is still 16:9, the width shrank to match, and the video is centred in
   the content area. The report lists the earlier full-width condition as replaced (↷), not failed.
6. Click **Undo**. The page goes back to the 1260 px column with the player inside it.

Also worth a try: after step 4, reload the page. The drawer shows "Page reloaded, changes removed", and
**Re-apply** brings the CSS back.

## If the JS variant fails

The agent inserts its CSS with origin `USER` and `!important` on every declaration. By the cascade that
beats inline styles, so the player should reach the content width on `video-js-sizing.html` too. If it
stays at the old width, set `PAGE_AGENT_CSS_ORIGIN` in `src/utils/pageAgentCss.ts` to `'AUTHOR'`,
rebuild and run the steps again.
