/* artoo-kit store — named JSON documents an artifact can save and reload.
 *
 * An explorer is only useful the second time if the configuration that made it
 * useful the first time survives. Browser storage is the cheap answer and the
 * wrong one: it is per-browser, invisible to the repo, lost on a profile reset,
 * and impossible to review in a diff. So the durable path writes through
 * `artoo serve` into the artifact's own `state/` directory — real files, next
 * to the work, committed with it, outside `site/` and therefore outside
 * anything the deploy firewall will ever publish.
 *
 *   const store = ArtooStore.open("presets");
 *   await store.list();                       // [{name, updated, bytes}, …]
 *   await store.save("means-heavy", weights); // writes state/presets/means-heavy.json
 *   await store.load("means-heavy");          // → weights
 *   await store.remove("means-heavy");
 *   store.durable                             // false when nothing is serving
 *
 * Opened from a `file://` URL or a plain static host there is no server to
 * write to, so the store falls back to localStorage and reports `durable ===
 * false`. Callers are expected to say so in the interface rather than let a
 * reader believe a save was persisted when it was not — `store.describe()`
 * returns a sentence fit to print.
 */
(function (global) {
  "use strict";

  var BASE = "/_artoo/state";
  var LOCAL_PREFIX = "artoo:state:";

  function jsonRequest(method, url, body) {
    var opts = { method: method, headers: { Accept: "application/json" } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(method + " " + url + " → " + res.status + " " + (t || res.statusText));
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function Store(collection, opts) {
    this.collection = collection;
    this.base = (opts && opts.base) || BASE;
    this.durable = false;
    this._probed = null;
  }

  /* One probe per store, memoised. A store that has not been probed reports
     itself undurable, which is the safe direction to be wrong in. */
  Store.prototype.probe = function () {
    var self = this;
    if (this._probed) return this._probed;
    if (global.location && global.location.protocol === "file:") {
      this.durable = false;
      this._probed = Promise.resolve(false);
      return this._probed;
    }
    this._probed = fetch(this.base + "/" + encodeURIComponent(this.collection), {
      headers: { Accept: "application/json" },
    }).then(function (res) {
      self.durable = res.ok;
      return res.ok;
    }).catch(function () {
      self.durable = false;
      return false;
    });
    return this._probed;
  };

  Store.prototype._url = function (name) {
    return this.base + "/" + encodeURIComponent(this.collection) +
      (name === undefined ? "" : "/" + encodeURIComponent(name));
  };

  Store.prototype._localKey = function (name) {
    return LOCAL_PREFIX + this.collection + ":" + name;
  };

  Store.prototype._localNames = function () {
    var prefix = LOCAL_PREFIX + this.collection + ":";
    var out = [];
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k.slice(prefix.length));
      }
    } catch (e) { /* storage disabled: an empty list is the honest answer */ }
    return out.sort();
  };

  Store.prototype.list = function () {
    var self = this;
    return this.probe().then(function (ok) {
      if (!ok) {
        return self._localNames().map(function (n) {
          return { name: n, updated: null, durable: false };
        });
      }
      return jsonRequest("GET", self._url()).then(function (payload) {
        return (payload && payload.entries) || [];
      });
    });
  };

  Store.prototype.load = function (name) {
    var self = this;
    return this.probe().then(function (ok) {
      if (!ok) {
        var raw = null;
        try { raw = global.localStorage.getItem(self._localKey(name)); } catch (e) { /* ignore */ }
        return raw === null ? null : JSON.parse(raw);
      }
      return jsonRequest("GET", self._url(name)).then(function (payload) {
        return payload ? payload.document : null;
      }).catch(function (err) {
        if (String(err).indexOf("404") !== -1) return null;
        throw err;
      });
    });
  };

  Store.prototype.save = function (name, document_) {
    var self = this;
    return this.probe().then(function (ok) {
      if (!ok) {
        try {
          global.localStorage.setItem(self._localKey(name), JSON.stringify(document_));
        } catch (e) {
          throw new Error("nothing is serving this artifact and browser storage refused the write");
        }
        return { name: name, durable: false };
      }
      return jsonRequest("PUT", self._url(name), { document: document_ }).then(function (r) {
        return Object.assign({ name: name, durable: true }, r || {});
      });
    });
  };

  Store.prototype.remove = function (name) {
    var self = this;
    return this.probe().then(function (ok) {
      if (!ok) {
        try { global.localStorage.removeItem(self._localKey(name)); } catch (e) { /* ignore */ }
        return true;
      }
      return jsonRequest("DELETE", self._url(name)).then(function () { return true; });
    });
  };

  /* A sentence for the interface to print, so the durability of a save is
     never something the reader has to infer from whether it worked. */
  Store.prototype.describe = function () {
    return this.durable
      ? "Saved to this artifact's state/ directory on disk."
      : "No server is attached, so saves stay in this browser only. Run `artoo serve` from the repo to write them to disk.";
  };

  global.ArtooStore = {
    open: function (collection, opts) { return new Store(collection, opts); },
    Store: Store,
  };
})(typeof window !== "undefined" ? window : this);
