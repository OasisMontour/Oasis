# Send to Oasis (Chrome extension)

A toolbar button for teachers. On any YouTube video, click it and Oasis opens a new lesson with that video
loaded, the title filled in, and the video's transcript already in **Draft questions with AI**.

- Manifest V3, plain JS, no build step, no background worker.
- Permissions: `activeTab` + `scripting` only. No host permissions, no install warning, and it can't see a page
  until the teacher clicks the button on it.
- It sends nothing anywhere. It reads the open YouTube tab and opens
  `/teacher/lessons/new?v=VIDEO_ID#yt=…`. The title and transcript ride in the `#fragment`, which browsers never send
  to a server. The builder validates it (`src/lib/youtubeHandoff.ts`) and only pre-fills; nothing is saved until Save.
- Plain `?v=VIDEO_ID` links work without the extension too.

## How the transcript is read

1. The caption track URL from the player response, as `json3`. **As of Nov 2026 YouTube answers this with an empty
   body** for normal web sessions (it wants a player-only token), so this mostly falls through. Kept because it's
   free when it works.
2. The **Show transcript** panel: the extension clicks the button (the same one under the description) and reads the
   timestamp/text lines off the page. It goes by the visible text, not YouTube's element names, so it survives the
   old panel and the newer `PAmodern_transcript_view`.

If neither works the builder says so and tells the teacher to copy the transcript by hand. Videos with no captions
are reported as "no captions", not as an error.

**None of this is an official API.** YouTube has no transcript API for videos you don't own, and its page changes
often. Expect this to break occasionally; when it does, the fix is in `collect.js` (and the manual paste still works).
**ToS:** YouTube's terms bar collecting content by automated means. This reads only what YouTube already shows the
signed-in teacher on the page they're watching, one click at a time, and is roughly what "copy the transcript" does
by hand. That's a gray area, not a clean bill of health. Don't extend it to bulk or background fetching.

## Try it (unpacked)

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this `extension/` folder.
2. Open a YouTube video, click the Oasis icon (pin it from the puzzle-piece menu), **Send this video**.

To point it at a preview deploy, change `OASIS_ORIGIN` in `config.js` and hit reload on the extensions page.

## Getting it to teachers

- **School Chromebooks:** managed Chromebooks usually block Developer mode and unlisted extensions. The district
  admin has to force-install it from the Google Admin console (Devices → Chrome → Apps & extensions → Users &
  browsers → add by Web Store ID). Ask IT alongside the other pilot asks.
- **Chrome Web Store:** needs a developer account ($5 one-time) and the account holder has to be 18+. Publish as
  **Unlisted** for the pilot. The listing needs a privacy policy URL (use `/privacy`) and a single-purpose
  description. Review usually takes a few days.
- Bump `version` in `manifest.json` for every upload.

## Tests

`npx vitest run extension` (runs with the app's test suite too). `collect.js` must stay self-contained because Chrome
serializes it into the page; there's a test that runs the serialized copy.
