import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@2/core/lit-core.min.js';

// Ensure the Lovelace visual editor element is registered when this card is loaded.
import './scrolling-calendar-card-editor.js';

console.log('scrolling-calendar-card module loaded v2.2');

class ScrollingCalendarCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _events: { type: Array },
      _transitionEnabled: { type: Boolean },
    };
  }
  
  static getConfigElement() {
    return document.createElement("scrolling-calendar-card-editor");
  }

  static getStubConfig() {
    return {
      type: 'custom:scrolling-calendar-card',
      entities: [{ entity: '', color: '#44739e' }],
      scroll_speed: 5,
      max_days: 7,
      show_date: true,
      show_time: true,
      time_format: '24h',
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      ha-card {
        height: 400px; /* Fixed height for scrolling area */
        overflow: hidden;
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--ha-card-background, #1c1c1c);
        color: var(--primary-text-color, #fff);
        border-radius: var(--ha-card-border-radius, 12px);
        box-shadow: var(--ha-card-box-shadow, none);
        border: 1px solid var(--ha-card-border-color, rgba(0,0,0,0));
      }
      .card-header {
        padding: 16px;
        font-size: 1.2rem;
        font-weight: bold;
        background: rgba(0,0,0,0.2);
        z-index: 2;
        position: relative;
      }
      #scroll-viewport {
        flex: 1;
        overflow: hidden;
        padding: 0;
      }

      #scroll-track {
        height: 100%;
        display: flex;
        flex-direction: column;
        will-change: transform;
      }
      .event-item {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%; /* Full height of the card */
        background: rgba(255, 255, 255, 0.05);
        border-radius: 0; /* Removing border radius for full card feel */
        overflow: hidden;
        flex-shrink: 0; 
        box-sizing: border-box;
      }
      .event-image {
        width: 80px;
        height: 80px;
        object-fit: cover;
        background-color: #333;
      }
      .event-details {
        padding: 8px 12px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        flex: 1;
      }
      .event-title {
        font-weight: bold;
        font-size: 1rem;
        margin-bottom: 4px;
      }
      .event-time {
        font-size: 0.85rem;
        opacity: 0.7;
      }
      .event-date {
        font-size: 0.75rem;
        opacity: 0.5;
        margin-top: 2px;
      }
    `;
  }

  constructor() {
    super();
    this._events = [];
    this._scrollIndex = 0;
    this._scrollTimer = null;
    this._transitionEnabled = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._scrollTimer) {
      clearInterval(this._scrollTimer);
      this._scrollTimer = null;
    }
  }

  setConfig(config) {
    if (!config.entities) {
      throw new Error('Please define entities');
    }
    this.config = config;
    this._startScroll();

    // If hass is already available (e.g., config edits), refetch immediately.
    if (this._hass) {
      this._fetchAllEvents();
    }
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    // Only fetch if hass changed significantly or init. 
    // For simplicity, we trigger fetch if we haven't yet or if needed.
    // In a real card, we carefully watch states.
    if (!this._events.length && hass) {
      this._fetchAllEvents();
    }
  }

  async _fetchAllEvents() {
    if (!this._hass || !this.config) return;

    const start = new Date().toISOString();
    const end = new Date();
    const maxDays = this.config.max_days || 7;
    end.setDate(end.getDate() + maxDays); 
    const endIso = end.toISOString();

    let allEvents = [];
    const entities = this.config.entities || [];

    for (const entityConf of entities) {
        const entityId = typeof entityConf === 'string' ? entityConf : entityConf.entity;
        const color = typeof entityConf === 'string' ? null : entityConf.color;

        try {
            // Using REST API as requested
            // Endpoint: calendars/{entity_id}?start={start}&end={end}
            const params = new URLSearchParams({
                start: start,
                end: endIso
            });
            const url = `calendars/${entityId}?${params.toString()}`;
            const events = await this._hass.callApi('GET', url);
            
            // Assign color to each event
            const coloredEvents = events.map(e => ({ ...e, color }));
            allEvents = allEvents.concat(coloredEvents);
            
        } catch (e) {
            console.error(`Error fetching events for ${entityId}`, e);
        }
    }

    // Sort by start time
    allEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

    // Filter past events
    const now = new Date();
    this._events = allEvents.filter(e => new Date(e.end.dateTime || e.end.date) > now);
    
    this.requestUpdate();
  }

  _startScroll() {
      if (this._scrollTimer) clearInterval(this._scrollTimer);
      const speed = (this.config.scroll_speed || 5) * 1000;
      
      this._scrollTimer = setInterval(() => {
          if (!this._events.length) return;
          
          // Animate to next item
          this._transitionEnabled = true;
          this._scrollIndex++;
          this.requestUpdate();

          // If we reached the clone (last item which is copy of first),
          // We need to reset to 0 after the transition completes.
          if (this._scrollIndex >= this._events.length) {
              setTimeout(() => {
                  this._transitionEnabled = false;
                  this._scrollIndex = 0;
                  this.requestUpdate();
              }, 1000); // 1s matches transition duration
          }
      }, speed);
  }

  _placeholderImageDataUrl() {
    // Inline SVG placeholder to avoid external network dependencies.
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <rect width="160" height="160" fill="#2f2f2f"/>
  <text x="80" y="86" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#bdbdbd">No Image</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  _getImageUrl(event) {
      if (event.description) {
          const match = event.description.match(/https?:\/\/[^\s]+(jpg|jpeg|png|gif|webp)/i); // Simple image extraction
           // Fallback for placeholder in description if not direct extension match
          if (!match && event.description.includes('http')) {
               const urlRegex = /(https?:\/\/[^\s]+)/;
               const found = event.description.match(urlRegex);
               if (found) return found[0];
          }
          if (match) return match[0];
      }
      return this._placeholderImageDataUrl();
  }

  _formatTime(isoStr) {
      if (!isoStr) return '';
      const date = new Date(isoStr);
      const is24h = this.config.time_format === '24h';
      return date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: !is24h 
      });
  }

  _formatDate(isoStr) {
      if (!isoStr) return '';
      const date = new Date(isoStr);
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  render() {
    if (!this._events.length) {
      return html`
        <ha-card>
          <div class="card-header">Upcoming Events</div>
          <div style="padding: 16px;">
            ${this.config.entities ? 'No upcoming events found.' : 'Please configure entities.'}
          </div>
        </ha-card>
      `;
    }

    // Kiosk Mode: Items are 100% height.
    // We use percentage logic for translateY.
    // 1 item = 100% height. Index 1 = -100%, Index 2 = -200%
    
    // We append a clone of the first event to the end.
    const displayEvents = [...this._events];
    if (displayEvents.length > 0) {
        displayEvents.push(displayEvents[0]); // Add clone for looping
    }
    
    const transitionStyle = this._transitionEnabled ? 'transform 1s ease-in-out' : 'none';
    const transformStyle = `translateY(-${this._scrollIndex * 100}%)`;

    return html`
      <ha-card>
        <div class="card-header">Upcoming Events</div>
        <div id="scroll-viewport">
          <div id="scroll-track" style="transition: ${transitionStyle}; transform: ${transformStyle};">
            ${displayEvents.map((event) => html`
              <div class="event-item">
                <img class="event-image" src="${this._getImageUrl(event)}" alt="Event Image" style="width: 50%;"> 
                <div class="event-details" style="width: 50%; border-left: ${event.color ? `8px solid ${event.color}` : 'none'}; padding-left: 24px;">
                  <div class="event-title" style="font-size: 1.5rem; margin-bottom: 8px;">${event.summary}</div>
                  ${this.config.show_time !== false ? html`<div class="event-time" style="font-size: 1.2rem;">${this._formatTime(event.start.dateTime)}</div>` : ''}
                  ${this.config.show_date !== false ? html`<div class="event-date" style="font-size: 1rem;">${this._formatDate(event.start.dateTime)}</div>` : ''}
                </div>
              </div>
            `)}
          </div>
        </div>
      </ha-card>
    `;
  }
  
  getCardSize() {
      return 3;
  }
}

customElements.define('scrolling-calendar-card', ScrollingCalendarCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "scrolling-calendar-card",
  name: "Scrolling Calendar Card",
  preview: true,
  description: "A Kiosk-style scrolling calendar card."
});
