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
