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
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
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
        if (target.type === "number") {
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

    return html`
      <div class="card-config">
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
      </div>
    `;
  }
}

customElements.define(
  "scrolling-calendar-card-editor",
  ScrollingCalendarCardEditor
);
