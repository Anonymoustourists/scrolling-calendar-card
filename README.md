# Scrolling Calendar Card

A custom Lovelace card for Home Assistant that displays upcoming calendar events in a vertically scrolling list. Designed for kiosk/dashboard displays, it features a billboard-style layout where each event takes up the full card height, with smooth auto-scrolling animations.

## Features

- **Kiosk Mode**: Events are displayed one at a time, taking up the full height of the card.
- **Auto-Scroll**: Automatically cycles through events with a smooth scrolling animation.
- **Infinite Loop**: Seamlessly loops back to the start after the last event.
- **Multiple Calendars**: Merge events from multiple calendar entities.
- **Color Customization**: Assign distinct colors to each calendar (displayed as a border/accent).
- **Visual Editor**: Fully configurable via the Lovelace UI editor.

## Installation

### HACS (Recommended)

1.  Ensure [HACS](https://hacs.xyz/) is installed.
2.  Go to **HACS > Frontend**.
3.  Click the menu icon (top right) and select **Custom repositories**.
4.  Add the URL of this repository and select **Lovelace** as the category.
5.  Click **Install**.

### Manual

1.  Download `scrolling-calendar-card.js` and `scrolling-calendar-card-editor.js` from the repository.
2.  Upload them to your Home Assistant `config/www/` directory.
3.  Add the reference to your `configuration.yaml` (or via Dashboards > Resources):
    ```yaml
    lovelace:
      resources:
        - url: /local/scrolling-calendar-card.js
          type: module
    ```

## Configuration

You can configure this card using the Visual Editor in Lovelace.

### YAML Configuration

```yaml
type: custom:scrolling-calendar-card
entities:
  - entity: calendar.family
    color: "#ff5722"
  - entity: calendar.work
    color: "#2196f3"
  - entity: calendar.social
    color: "#4caf50"
scroll_speed: 5
max_days: 7
show_date: true
show_time: true
time_format: 24h
```

### Kiosk / Screensaver (Overlay Layout)

This layout is optimized for wall tablets (e.g. 10" / 8" tablets in landscape): full-bleed image, bottom text band, and a colored frame per event.

```yaml
type: custom:scrolling-calendar-card
layout: overlay
entities:
  - entity: calendar.family
    color: "#ff5722"
  - entity: calendar.detroit_prep_family_calendar
    color: "#2196f3"
scroll_speed: 8
max_days: 7
show_time: true
show_date: true
time_format: 24h

# Images
image_map_url: /local/scrolling-calendar-card/event-images/event-image-map.json
image_map_refresh_seconds: 300
default_image: /local/scrolling-calendar-card/defaults/neutral.jpg

# Overlay style knobs
overlay_height_pct: 15
overlay_opacity: 0.55
frame_width_px: 6
show_calendar_name: false

# Optional: align the image focal point (CSS background-position)
image_position: center
```

| Option         | Type    | Default  | Description                                                                                  |
| :------------- | :------ | :------- | :------------------------------------------------------------------------------------------- |
| `entities`     | list    | required | List of calendar entities to display. Can be list of strings or objects `{ entity, color }`. |
| `scroll_speed` | number  | 5        | Time in seconds to display each event before scrolling.                                      |
| `max_days`     | number  | 7        | Number of days into the future to fetch events for.                                          |
| `show_date`    | boolean | true     | Show the event date.                                                                         |
| `show_time`    | boolean | true     | Show the event time.                                                                         |
| `time_format`  | string  | '12h'    | Time format: `'12h'` (AM/PM) or `'24h'`.                                                     |

### Layout Options

| Option   | Type   | Default | Description |
| :------- | :----- | :------ | :---------- |
| `layout` | string | split   | `split` (legacy image + details columns) or `overlay` (screensaver-style background image with bottom band). |

## Images

This card supports multiple ways to show images:

1) **Generated JSON image map (recommended)** via `image_map_url` (best for AI-generated images)
2) **Event description directive**: put `image: https://...` in the calendar event description
3) **Rule-based mapping** (`image_rules`, for manual mappings)
4) **Default image** (`default_image`) or an inline placeholder

### Image Map Options

| Option                     | Type    | Default | Description |
| :------------------------- | :------ | :------ | :---------- |
| `image_map_url`            | string  | none    | URL to a JSON file (typically under `/local/...`) containing event→image mappings. |
| `image_map_refresh_seconds`| number  | 300     | How often to re-fetch the JSON map. |
| `default_image`            | string  | none    | Fallback image URL when no mapping exists. |
| `image_from_description`   | boolean | true    | If true, uses `image:` directive (or first URL) from the event description. |

### Style Options

| Option             | Type   | Default | Description |
| :----------------- | :----- | :------ | :---------- |
| `background_color` | string | none    | Overrides the card background color. |
| `text_color`       | string | none    | Overrides the card text color. |
| `image_width`      | string | none    | CSS width for the image area (e.g. `40%` or `240px`). |
| `image_fit`        | string | cover   | CSS `object-fit` for the image (`cover`, `contain`, ...). |

### Overlay Style Options (Overlay layout)

| Option               | Type    | Default | Description |
| :------------------- | :------ | :------ | :---------- |
| `overlay_height_pct` | number  | 15      | Height of the bottom overlay band in percent of the card height. |
| `overlay_opacity`    | number  | 0.55    | Darkness of the bottom overlay band ($0..1$). |
| `frame_width_px`     | number  | 6       | Width of the colored frame border in pixels. |
| `title_font_size`    | string  | `clamp(22px, 3vw, 42px)` | CSS font-size for the title (advanced; optional). |
| `meta_font_size`     | string  | `clamp(14px, 2vw, 22px)` | CSS font-size for the meta line (advanced; optional). |
| `image_position`     | string  | center  | CSS background-position for the image (e.g. `center`, `top`, `50% 30%`). |
| `show_calendar_name` | boolean | false   | If true, appends the calendar name to the meta line. |

## Optional: Auto-generate images with OpenAI

If you want the card to automatically show images per event, the repo includes a small Python helper:

- Script: [tools/ha_event_image_generator/generate_event_images.py](tools/ha_event_image_generator/generate_event_images.py)

It pulls events from the HA Calendar API, generates an image for each event, saves images under `/config/www/...`, and writes a JSON mapping file the card can load.

### LAN workflow (recommended): generate on your Mac, push to HA host

This repo supports a simple LAN workflow where:

- The generator runs locally on your MacBook Air.
- It writes artifacts under `./out/event-images/...`.
- A push utility copies images + JSON to your HA host (e.g. `m4mm`) over SSH.
- The card reads **only** from `/local/...` via `image_map_url`.

### 1) Configure

Copy and edit the example config:

- [tools/ha_event_image_generator/config.example.yaml](tools/ha_event_image_generator/config.example.yaml)

Set these environment variables where you run the script:

- `HA_TOKEN`: Home Assistant Long-Lived Access Token
- `OPENAI_API_KEY`: OpenAI API key

For local development on your Mac, use a local `.env` file instead of exporting env vars:

- Example env file: [tools/ha_event_image_generator/.env.example](tools/ha_event_image_generator/.env.example)
- Create (do not commit): `tools/ha_event_image_generator/.env`

Required env vars:

- `OPENAI_API_KEY`
- `HA_BASE_URL` (from your Mac; e.g. `http://m4mm:8123` or `http://<LAN_IP>:8123`)
- `HA_TOKEN`

Optional (used by the push script):

- `M4MM_HOST` (default `m4mm`)
- `M4MM_WWW_ROOT` (default `/Volumes/ScriptsM4/newhome/ha-config/www`)

### 2) Install deps (venv)

```bash
cd tools/ha_event_image_generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Run

```bash
cd tools/ha_event_image_generator
python generate_event_images.py --config ./config.yaml
```

By default, the generator writes locally to:

- `./out/event-images/event-image-map.json`
- `./out/event-images/event-status.json`
- `./out/event-images/img/*.png`

### 4) Push artifacts to your HA host (m4mm)

The repo includes a push utility that prefers `rsync` and falls back to `scp`.

Targets on `m4mm`:

- Images + JSON: `/Volumes/ScriptsM4/newhome/ha-config/www/scrolling-calendar-card/event-images/`
  - `event-image-map.json`
  - `event-status.json`
  - `img/*.png`
- Card JS (during dev): `/Volumes/ScriptsM4/newhome/ha-config/www/community/scrolling-calendar-card/`
  - `scrolling-calendar-card.js`
  - `scrolling-calendar-card-editor.js`

Push images + JSON:

```bash
python3 scripts/push_to_m4mm.py --what images,json --out-dir ./out/event-images
```

Push card JS too (dev only):

```bash
python3 scripts/push_to_m4mm.py --what images,json,card --out-dir ./out/event-images
```

One-command generate + push:

```bash
./scripts/dev_workflow.sh tools/ha_event_image_generator/config.yaml ./out/event-images images,json,card
```

### Pending questions + overrides (for unclear events)

Some calendar event summaries are too vague (e.g. short codes or 1–2 word entries). The generator can skip those and ask you to clarify later.

- Pending questions file (JSON): `./out/event-images/pending-questions.json`
  - The generator writes entries like: `{ uid, fallback_key, calendar_entity_id, summary, start, question, suggested_examples, created_at }`
- Status file (JSON): `./out/event-images/event-status.json`
  - Includes `needs_info: true` when an event was skipped for clarification.

To provide clarifications without editing your calendar events, use an overrides YAML file and point `prompting.overrides_file` to it:

```yaml
overrides:
  by_uid:
    "<uid>":
      clarified_summary: "Jaxon school lunch: pizza"
  by_fallback:
    "calendar.family|Movie night|2025-12-20":
      clarified_summary: "Family movie night at home"
```

### 4) Point the card at the map

Example card config:

```yaml
type: custom:scrolling-calendar-card
entities:
  - entity: calendar.personal
    color: "#ff5722"
  - entity: calendar.detroit_prep_family_calendar
    color: "#2196f3"
  - entity: calendar.family
scroll_speed: 5
max_days: 7
show_date: true
show_time: true
time_format: 24h
image_map_url: /local/scrolling-calendar-card/event-images/event-image-map.json
image_map_refresh_seconds: 300
image_width: 50%
```

### Notes on recurring events

If your calendar provider supplies a stable `uid` for recurring events, the generator stores mappings in `by_uid` so every instance of that recurring event can share the same image automatically.
