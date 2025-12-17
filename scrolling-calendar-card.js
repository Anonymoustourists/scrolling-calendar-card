import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js';

console.log('scrolling-calendar-card module loaded');

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

  static get styles() {
    return css`
      :host {
        display: block;
        height: 400px; /* Fixed height for scrolling area */
        overflow: hidden;
        position: relative;
        background: var(--ha-card-background, #1c1c1c);
        color: var(--primary-text-color, #fff);
        border-radius: var(--ha-card-border-radius, 12px);
        box-shadow: var(--ha-card-box-shadow, none);
      }
      .card-header {
        padding: 16px;
        font-size: 1.2rem;
        font-weight: bold;
        background: rgba(0,0,0,0.2);
        z-index: 2;
        position: relative;
      }
      #scroll-container {
        height: 100%;
        overflow-y: hidden; /* Hide scrollbar */
        padding: 0; 
        display: flex;
        flex-direction: column;
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

  setConfig(config) {
    if (!config.entities) {
      throw new Error('Please define entities');
    }
    this.config = config;
    this._startScroll();
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
        // Handle both simple string list (legacy) and new object list
        const entity_id = typeof entityConf === 'string' ? entityConf : entityConf.entity;
        const color = typeof entityConf === 'string' ? null : entityConf.color;
        
        try {
            // Mock implementation uses callApi or we can simulate it
            const events = await this._hass.callApi('GET', `calendars/${entity_id}/events?start=${start}&end=${endIso}`);
            
            // Attach color to events
            const coloredEvents = events.map(e => ({ ...e, color }));
            
            allEvents = allEvents.concat(coloredEvents);
        } catch (e) {
            console.error(`Error fetching events for ${entity_id}`, e);
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
      return 'https://via.placeholder.com/80?text=No+Img';
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
          <div style="padding: 16px;">No upcoming events found.</div>
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
      <!-- Kiosk mode usually hides header or makes it overlay. Keeping it for now. -->
      <div class="card-header">Upcoming Events</div>
      <div id="scroll-container" style="transition: ${transitionStyle}; transform: ${transformStyle};">
        ${displayEvents.map((event, index) => html`
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
    `;
  }
  
  getCardSize() {
      return 3;
  }
}

customElements.define('scrolling-calendar-card', ScrollingCalendarCard);
