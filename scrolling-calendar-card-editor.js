import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@2/core/lit-core.min.js';

console.log("ScrollingCalendarCardEditor: Module loaded v2.2");

class ScrollingCalendarCardEditor extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: { attribute: false },
    };
  }

  setConfig(config) {
    this._config = { ...config };
    console.log("ScrollingCalendarCardEditor: setConfig called", config);
  }

  static get styles() {
    return css`
      :host {
        display: block;
        max-height: 100%;
        overflow: auto;
        box-sizing: border-box;
      }

      .card-config {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        box-sizing: border-box;
      }
      .option {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .option-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        border: 1px solid #ddd;
        padding: 12px;
        border-radius: 8px;
      }
      label {
        font-weight: bold;
        min-width: 150px;
      }
      input[type="text"],
      input[type="number"],
      select {
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #ccc;
        flex: 1;
      }
      input[type="checkbox"] {
        flex: 0;
      }
      .entity-row {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
        align-items: center;
      }
      button {
        cursor: pointer;
        padding: 4px 8px;
        background-color: #03a9f4;
        color: white;
        border: none;
        border-radius: 4px;
      }
      button:hover {
        background-color: #0288d1;
      }
      button.remove-btn {
        background-color: #f44336;
      }
      button.remove-btn:hover {
        background-color: #d32f2f;
      }

      .hint {
        font-size: 0.85rem;
        opacity: 0.8;
        margin-top: 4px;
      }
    `;
  }

  configChanged(newConfig) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) {
      return;
    }
    const target = ev.target;
    if (this[`_${target.configValue}`] === target.value) {
      return;
    }
    if (target.configValue) {
      if (target.value === "") {
        delete this._config[target.configValue];
      } else {
        let value = target.value;
        if (target.type === "number" || target.type === "range") {
          value = Number(value);
        }
        if (target.type === "checkbox") {
          value = target.checked;
        }
        this._config = { ...this._config, [target.configValue]: value };
      }
    }
    this.configChanged(this._config);
  }

  _addEntity() {
    const entities = [...(this._config.entities || [])];
    entities.push({ entity: "", color: "#ffffff" });
    this._config = { ...this._config, entities };
    this.configChanged(this._config);
  }

  _removeEntity(index) {
    const entities = [...(this._config.entities || [])];
    entities.splice(index, 1);
    this._config = { ...this._config, entities };
    this.configChanged(this._config);
  }

  _entityChanged(ev, index, field) {
    const entities = [...(this._config.entities || [])];
    let entry = entities[index];

    // Normalize string entries to objects if needed
    if (typeof entry === "string") {
      entry = { entity: entry, color: "#44739e" };
    } else {
      entry = { ...entry };
    }

    entry[field] = ev.target.value;
    entities[index] = entry;

    this._config = { ...this._config, entities };
    this.configChanged(this._config);
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const entities = this._config.entities || [];
    const layout = this._config.layout || 'split';

    return html`
      <div class="card-config">
        <div class="option-group">
          <label>Layout</label>
          <div class="option">
            <label>Mode</label>
            <select
              .value="${layout}"
              .configValue="${"layout"}"
              @change="${(e) => this._valueChanged(e)}"
            >
              <option value="split">Split (legacy)</option>
              <option value="overlay">Overlay (kiosk/screensaver)</option>
            </select>
          </div>
          <div class="hint">
            Overlay mode renders a full-bleed background image with a bottom text band.
          </div>
        </div>

        <div class="option-group">
          <label>Calendars</label>
          ${entities.map((entityConf, index) => {
            const entityId =
              typeof entityConf === "string" ? entityConf : entityConf.entity;
            const color =
              typeof entityConf === "string"
                ? "#44739e"
                : entityConf.color || "#44739e";

            return html`
              <div class="entity-row">
                <input
                  type="text"
                  .value="${entityId}"
                  @change="${(e) => this._entityChanged(e, index, "entity")}"
                  placeholder="calendar.example"
                  style="flex: 1;"
                />
                <input
                  type="color"
                  .value="${color}"
                  @change="${(e) => this._entityChanged(e, index, "color")}"
                />
                <button
                  class="remove-btn"
                  @click="${() => this._removeEntity(index)}"
                >
                  X
                </button>
              </div>
            `;
          })}
          <button @click="${() => this._addEntity()}">+ Add Calendar</button>
        </div>

        <div class="option">
          <label>Scroll Speed (sec)</label>
          <input
            type="number"
            .value="${this._config.scroll_speed || 5}"
            .configValue="${"scroll_speed"}"
            @input="${(e) => this._valueChanged(e)}"
          />
        </div>
        <div class="option">
          <label>Max Days to Show</label>
          <input
            type="number"
            .value="${this._config.max_days || 7}"
            .configValue="${"max_days"}"
            @input="${(e) => this._valueChanged(e)}"
          />
        </div>
        <div class="option">
          <label>Show Date</label>
          <input
            type="checkbox"
            .checked="${this._config.show_date !== false}"
            .configValue="${"show_date"}"
            @change="${(e) => this._valueChanged(e)}"
          />
        </div>
        <div class="option">
          <label>Show Time</label>
          <input
            type="checkbox"
            .checked="${this._config.show_time !== false}"
            .configValue="${"show_time"}"
            @change="${(e) => this._valueChanged(e)}"
          />
        </div>
        <div class="option">
          <label>Time Format</label>
          <select
            .value="${this._config.time_format || "12h"}"
            .configValue="${"time_format"}"
            @change="${(e) => this._valueChanged(e)}"
          >
            <option value="12h">12 Hour (AM/PM)</option>
            <option value="24h">24 Hour</option>
          </select>
        </div>

        <div class="option-group">
          <label>Images</label>
          <div class="option">
            <label>Image Map URL</label>
            <input
              type="text"
              .value="${this._config.image_map_url || ""}"
              .configValue="${"image_map_url"}"
              @input="${(e) => this._valueChanged(e)}"
              placeholder="/local/scrolling-calendar-card/event-images/event-image-map.json"
            />
          </div>
          <div class="hint">
            If provided, the card will load this JSON file and use it to map events to images (recommended for AI-generated images).
          </div>
          <div class="option">
            <label>Map Refresh (sec)</label>
            <input
              type="number"
              .value="${this._config.image_map_refresh_seconds || 300}"
              .configValue="${"image_map_refresh_seconds"}"
              @input="${(e) => this._valueChanged(e)}"
            />
          </div>
          <div class="option">
            <label>Default Image URL</label>
            <input
              type="text"
              .value="${this._config.default_image || ""}"
              .configValue="${"default_image"}"
              @input="${(e) => this._valueChanged(e)}"
              placeholder="/local/scrolling-calendar-card/default.png"
            />
          </div>
          <div class="option">
            <label>Image from Description</label>
            <input
              type="checkbox"
              .checked="${this._config.image_from_description !== false}"
              .configValue="${"image_from_description"}"
              @change="${(e) => this._valueChanged(e)}"
            />
          </div>
        </div>

        <div class="option-group">
          <label>Overlay Style</label>
          <div class="option">
            <label>Overlay Height (%)</label>
            <input
              type="range"
              min="8"
              max="30"
              step="1"
              .value="${Number(this._config.overlay_height_pct ?? 15)}"
              .configValue="${"overlay_height_pct"}"
              @input="${(e) => this._valueChanged(e)}"
            />
            <span>${Number(this._config.overlay_height_pct ?? 15)}%</span>
          </div>
          <div class="option">
            <label>Overlay Opacity</label>
            <input
              type="range"
              min="0.2"
              max="0.9"
              step="0.05"
              .value="${Number(this._config.overlay_opacity ?? 0.55)}"
              .configValue="${"overlay_opacity"}"
              @input="${(e) => this._valueChanged(e)}"
            />
            <span>${Number(this._config.overlay_opacity ?? 0.55).toFixed(2)}</span>
          </div>
          <div class="option">
            <label>Frame Width (px)</label>
            <input
              type="number"
              min="0"
              max="20"
              step="1"
              .value="${Number(this._config.frame_width_px ?? 6)}"
              .configValue="${"frame_width_px"}"
              @input="${(e) => this._valueChanged(e)}"
            />
          </div>
          <div class="option">
            <label>Show Calendar Name</label>
            <input
              type="checkbox"
              .checked="${this._config.show_calendar_name === true}"
              .configValue="${"show_calendar_name"}"
              @change="${(e) => this._valueChanged(e)}"
            />
          </div>
          <div class="hint">
            These options primarily affect Overlay mode.
          </div>
        </div>

        <div class="option-group">
          <label>Style</label>
          <div class="option">
            <label>Background Color</label>
            <input
              type="text"
              .value="${this._config.background_color || ""}"
              .configValue="${"background_color"}"
              @input="${(e) => this._valueChanged(e)}"
              placeholder="#1c1c1c"
            />
          </div>
          <div class="option">
            <label>Text Color</label>
            <input
              type="text"
              .value="${this._config.text_color || ""}"
              .configValue="${"text_color"}"
              @input="${(e) => this._valueChanged(e)}"
              placeholder="#ffffff"
            />
          </div>
          <div class="option">
            <label>Image Width</label>
            <input
              type="text"
              .value="${this._config.image_width || ""}"
              .configValue="${"image_width"}"
              @input="${(e) => this._valueChanged(e)}"
              placeholder="50% (or 240px)"
            />
          </div>
          <div class="option">
            <label>Image Fit</label>
            <select
              .value="${this._config.image_fit || "cover"}"
              .configValue="${"image_fit"}"
              @change="${(e) => this._valueChanged(e)}"
            >
              <option value="cover">cover</option>
              <option value="contain">contain</option>
              <option value="fill">fill</option>
              <option value="none">none</option>
              <option value="scale-down">scale-down</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define(
  "scrolling-calendar-card-editor",
  ScrollingCalendarCardEditor
);
