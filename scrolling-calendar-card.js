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
        background: var(--scc-background, var(--ha-card-background, #1c1c1c));
        color: var(--scc-text-color, var(--primary-text-color, #fff));
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
        width: var(--scc-image-width, 50%);
        height: 100%;
        object-fit: var(--scc-image-fit, cover);
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
    this._imageMapTimer = null;
    this._imageMap = null;
    this._transitionEnabled = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._scrollTimer) {
      clearInterval(this._scrollTimer);
      this._scrollTimer = null;
    }
    if (this._imageMapTimer) {
      clearInterval(this._imageMapTimer);
      this._imageMapTimer = null;
    }
  }

  setConfig(config) {
    if (!config.entities) {
      throw new Error('Please define entities');
    }
    this.config = config;
    this._startScroll();

    this._setupImageMapRefresh();

    // If hass is already available (e.g., config edits), refetch immediately.
    if (this._hass) {
      this._fetchAllEvents();
    }
  }

  async _fetchImageMapOnce() {
    const url = this.config?.image_map_url;
    if (!url) {
      this._imageMap = null;
      return;
    }

    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        console.warn(`scrolling-calendar-card: image_map_url fetch failed (${resp.status})`, url);
        this._imageMap = null;
        return;
      }
      const data = await resp.json();
      this._imageMap = data;
    } catch (e) {
      console.warn('scrolling-calendar-card: image_map_url fetch error', e);
      this._imageMap = null;
    }
  }

  _setupImageMapRefresh() {
    if (this._imageMapTimer) {
      clearInterval(this._imageMapTimer);
      this._imageMapTimer = null;
    }

    const url = this.config?.image_map_url;
    if (!url) {
      this._imageMap = null;
      return;
    }

    // Immediate fetch, then periodic refresh.
    this._fetchImageMapOnce();

    const refreshSeconds = Number(this.config?.image_map_refresh_seconds || 300);
    if (Number.isFinite(refreshSeconds) && refreshSeconds > 0) {
      this._imageMapTimer = setInterval(() => {
        this._fetchImageMapOnce();
      }, refreshSeconds * 1000);
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
            
            // Preserve the source calendar entityId and per-calendar color
            const coloredEvents = events.map(e => ({
              ...e,
              color,
              calendarEntityId: entityId,
            }));
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

  _getEventUid(event) {
    return (
      event?.uid ||
      event?.recurring_event_id ||
      event?.recurrence_id ||
      event?.id ||
      ''
    );
  }

  _getImageFromMap(event) {
    const map = this._imageMap;
    if (!map) return null;

    const uid = this._getEventUid(event);
    const calendarEntityId = event?.calendarEntityId || '';
    const start = event?.start?.dateTime || event?.start?.date || '';
    const summary = (event?.summary || '').toString();

    // Preferred: by_uid map
    const byUid = map?.by_uid;
    if (uid && byUid && typeof byUid === 'object' && byUid[uid]?.image_url) {
      return byUid[uid].image_url;
    }

    // Fallback: by_fallback key (same hashing as generator script)
    const raw = `${calendarEntityId}|${summary}|${start}`;
    const byFallback = map?.by_fallback;
    if (byFallback && typeof byFallback === 'object') {
      const compositeKey = raw;
      if (byFallback[compositeKey]?.image_url) return byFallback[compositeKey].image_url;
    }

    // Support a flat list: { events: [ { uid, image_url } ] }
    const events = Array.isArray(map?.events) ? map.events : null;
    if (events) {
      const found = events.find((e) => (uid && e.uid === uid) || (e.calendar_entity_id === calendarEntityId && e.summary === summary && e.start === start));
      if (found?.image_url) return found.image_url;
      if (found?.image) return found.image;
    }

    return null;
  }

  _parseRegexLike(input) {
    if (typeof input !== 'string') return null;
    // Support /pattern/flags
    if (!input.startsWith('/')) return null;
    const lastSlash = input.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    const pattern = input.slice(1, lastSlash);
    const flags = input.slice(lastSlash + 1);
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  _matchesRule(event, rule) {
    if (!rule || typeof rule !== 'object') return false;

    const match = rule.match && typeof rule.match === 'object' ? rule.match : rule;
    const ruleEntity = match.entity || match.calendar || null;
    const ruleUid = match.uid || null;
    const ruleSummary = match.summary || match.title || null;

    if (ruleEntity && event?.calendarEntityId !== ruleEntity) return false;

    if (ruleUid) {
      const uid = this._getEventUid(event);
      if (!uid || uid !== ruleUid) return false;
    }

    if (ruleSummary) {
      const summary = (event?.summary || '').toString();
      const asRegex = this._parseRegexLike(ruleSummary);
      if (asRegex) {
        if (!asRegex.test(summary)) return false;
      } else {
        if (!summary.toLowerCase().includes(ruleSummary.toLowerCase())) return false;
      }
    }

    return true;
  }

  _getImageFromRules(event) {
    const rules = Array.isArray(this.config?.image_rules) ? this.config.image_rules : [];
    for (const rule of rules) {
      const image = rule?.image;
      if (!image) continue;
      if (this._matchesRule(event, rule)) return image;
    }
    return null;
  }

  _getImageFromDescription(description) {
    if (!description || typeof description !== 'string') return null;

    // Explicit directive takes precedence: image: <url>
    const directiveMatch = description.match(/^\s*(?:image|img)\s*:\s*(\S+)\s*$/im);
    if (directiveMatch?.[1]) return directiveMatch[1];

    // Fall back to first URL ending in a common image extension
    const extMatch = description.match(/https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s]*)?/i);
    if (extMatch?.[0]) return extMatch[0];

    // Or any first URL (last resort)
    const urlMatch = description.match(/https?:\/\/[^\s]+/i);
    if (urlMatch?.[0]) return urlMatch[0];

    return null;
  }

  _cssVarStyle() {
    const vars = [];
    const background = this.config?.background_color;
    const textColor = this.config?.text_color;
    const imageWidth = this.config?.image_width;
    const imageFit = this.config?.image_fit;

    if (background) vars.push(`--scc-background:${background}`);
    if (textColor) vars.push(`--scc-text-color:${textColor}`);
    if (imageWidth) vars.push(`--scc-image-width:${imageWidth}`);
    if (imageFit) vars.push(`--scc-image-fit:${imageFit}`);

    return vars.join(';');
  }

  _getImageUrl(event) {
      // 0) External map generated by helper (preferred)
      const fromMap = this._getImageFromMap(event);
      if (fromMap) return fromMap;

      // 1) Explicit description directive (image: ...)
      if (this.config?.image_from_description !== false) {
      const fromDescription = this._getImageFromDescription(event?.description);
      if (fromDescription) return fromDescription;
      }

      // 2) Config rule-based mapping
      const fromRules = this._getImageFromRules(event);
      if (fromRules) return fromRules;

      // 3) Configurable default image
      if (this.config?.default_image) return this.config.default_image;

      // 4) Inline placeholder
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
        <ha-card style="${this._cssVarStyle()}">
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
      <ha-card style="${this._cssVarStyle()}">
        <div class="card-header">Upcoming Events</div>
        <div id="scroll-viewport">
          <div id="scroll-track" style="transition: ${transitionStyle}; transform: ${transformStyle};">
            ${displayEvents.map((event) => html`
              <div class="event-item">
                <img class="event-image" src="${this._getImageUrl(event)}" alt="Event Image"> 
                <div class="event-details" style="border-left: ${event.color ? `8px solid ${event.color}` : 'none'}; padding-left: 24px;">
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
