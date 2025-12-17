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

| Option         | Type    | Default  | Description                                                                                  |
| :------------- | :------ | :------- | :------------------------------------------------------------------------------------------- |
| `entities`     | list    | required | List of calendar entities to display. Can be list of strings or objects `{ entity, color }`. |
| `scroll_speed` | number  | 5        | Time in seconds to display each event before scrolling.                                      |
| `max_days`     | number  | 7        | Number of days into the future to fetch events for.                                          |
| `show_date`    | boolean | true     | Show the event date.                                                                         |
| `show_time`    | boolean | true     | Show the event time.                                                                         |
| `time_format`  | string  | '12h'    | Time format: `'12h'` (AM/PM) or `'24h'`.                                                     |

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

## Optional: Auto-generate images with OpenAI

If you want the card to automatically show images per event, the repo includes a small Python helper:

- Script: [tools/ha_event_image_generator/generate_event_images.py](tools/ha_event_image_generator/generate_event_images.py)

It pulls events from the HA Calendar API, generates an image for each event, saves images under `/config/www/...`, and writes a JSON mapping file the card can load.

### 1) Configure

Copy and edit the example config:

- [tools/ha_event_image_generator/config.example.yaml](tools/ha_event_image_generator/config.example.yaml)

Set these environment variables where you run the script:

- `HA_TOKEN`: Home Assistant Long-Lived Access Token
- `OPENAI_API_KEY`: OpenAI API key

### 2) Install deps (venv)

```bash
cd tools/ha_event_image_generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Run

```bash
export HA_TOKEN="..."
export OPENAI_API_KEY="..."

python generate_event_images.py --config ./config.example.yaml
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
