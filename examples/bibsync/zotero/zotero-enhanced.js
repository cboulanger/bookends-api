const path = require('path');
const fs = require('fs');
const process = require('process');
const util = require('util');
const crypto = require('crypto');
const EventEmitter = require('events');

const zotero = require('zotero');
const request = require("request");

zotero.promisify(util.promisify.bind(Promise));

const library = new zotero.Library({ group: process.env.ZOTERO_GROUP_ID, key: process.env.ZOTERO_API_KEY });

/**
 * A model of a Zotero item
 */
class Item extends EventEmitter {

  /**
   * Send all items in the queue
   * @return {*}
   */
  static async sendAll(){
    let keyList = {};
    while (Item.queue.length) {
      //let version = await library.getVersion();
      let data = Item.queue.map(item => {
        //This should work, but doesn't
        //if (!item.data.key) item.data.version = 0;
        return item.data;
      });
      // send to server
      let message = await library.client.post(
      /* path */    library.path('items'),
      /* options */ {key: library.key},
      /* items */   data,
      /* headers */ { 'Zotero-Write-Token': Item.createWriteToken() }
      //* headers */ {'If-Unmodified-Since-Version': version}
      );
      if (!message.ok) throw message.error;
      let idsFailed = Object.getOwnPropertyNames(message.data.failed);
      if (idsFailed.length) {
        let error = new Error("Some or all of the requests failed:");
        error.failedItems = idsFailed.map(id => [message.data.failed[id].message, JSON.stringify(data[id])]);
        throw error;
      }
      let idsSuccess = Object.getOwnPropertyNames(message.data.success);
      let queueCopy = [].concat(Item.queue);
      // empty queue
      Item.queue = [];
      // add server data to items and emit events
      idsSuccess.forEach(id => {
        let item = queueCopy[id];
        item.data.key = message.data.success[id];
        item.data.version = message.version;
        item.saved = true;
        item.emit("saved", message.data.success[id]);
      });
      Object.assign(keyList, message.data.success);
    } // end while
    // return the list of keys
    return keyList;
  }

  /**
   * Create a random 32-character string which is used to make unversioned write requests
   * @return {string}
   */
  static createWriteToken(){
    return crypto.createHash('sha1').update(""+(new Date).getTime()+Math.random()).digest('hex').substr(0,32);
  }

  /**
   * Returns true if there are still uploads going on
   * @return {boolean}
   */
  static hasPendingUploads() {
    return Object.getOwnPropertyNames(this.pendingUploads).length > 0;
  }

  /**
   * Returns a promise that resolves when all uploads are completed
   * @return {Promise<void>}
   */
  static async waitForPendingUploads() {
    while (this.hasPendingUploads()){
      await new Promise(resolve => setTimeout( () => resolve(), 1000));
    }
  }

  /**
   * Constructor
   * @param {String} itemType The type of the item
   * @param {Boolean} debug Output debug messages (default: false)
   */
  constructor (itemType, debug = false){
    super();

    if(!itemType || typeof itemType !== "string") throw new Error("Invalid argument");

    /**
     * Show debug messages
     * @type {boolean}
     */
    this.debug = debug;

    /**
     * Whether the item has been initialized
     * @type {boolean}
     */
    this.isInitialized = false;

    /**
     * Whether this item has been saved to the server
     * @type {boolean}
     */
    this.saved = false;

    /**
     * The item data
     * @type {{}}
     */
    this.data = { itemType };

    /**
     * The parent of this item, if any
     * @type {null|Item}
     */
    this.parent = null;

  }

  /**
   * Initialize the item
   * @return {Promise<void>}
   */
  async init (){
    let itemType = this.data.itemType;
    if( Item.templates[itemType] === undefined) {
      Item.templates[itemType] = await this.downloadTemplate(itemType);
    }
    this.data = Object.assign({}, Item.templates[itemType], this.data);
    this.isInitialized = true;
  }

  /**
   * Downloads the item template
   * @return {Promise<void>}
   */
  async downloadTemplate(itemType){
    return (await library.client.get("/items/new?itemType=" + itemType)).data;
  }

  /**
   * Set or change data
   * @param data
   * @return {Promise<void>}
   */
  async set(data){
    if(! this.isInitialized) await this.init();
    Object.getOwnPropertyNames(data).forEach(field => {
      if (field in this.data) {
        this.data[field] = data[field];
      } else if(this.debug){
        console.warn(`${field} ('${data[field]}') is not a valid field for type ${this.data.itemType}`);
      }
    });
  }

  /**
   * Sets the parent of this item
   * @param {Item} item
   */
  setParent(item) {
    if (! item instanceof Item) throw new TypeError('Argument must be instance of zotero.Item. ');
    this.parent = item;
  }

  /**
   * Saves the item on the Zotero server. Returns a Promise.
   * @param asBatch
   *    If true (defaults to false), do not send right away, but put on a queue to
   *    send in a batch by calling Item.saveAll()
   * @return {Promise<String|null>}
   *    The Promise resolves to the item key if asBatch is false or null asBatch is true or if the item has a parent
   *    that needs to be saved to the server first.
   */
  async save(asBatch=false){
    if (! this.isInitialized) await this.init();
    if (this.parent) {
      if (this.parent.saved){
        this.data.parentItem = this.parent.data.key;
      } else {
        this.parent.on("saved", key => {
          this.data.parentItem = key;
          this.save(asBatch);
        });
        return Promise.resolve(null);
      }
    }
    Item.queue.push(this);
    if (asBatch) return Promise.resolve(null);
    return (await Item.sendAll())[0];
  }
}

class Note extends Item {
  constructor(note, parent){
    super('note');
    if( parent ){
      if (! parent instanceof Item) throw new Error("Parent must be instance of Item");
      this.setParent(parent);
    }
    this.set({note});
  }
}

class Attachment extends Item {

  constructor(filepath, linkMode, parent) {
    super('attachment');
    this.setLinkMode(linkMode);
    if(parent) this.setParent(parent);
    this.setFilepath(filepath);
  }


  /**
   * Setter for linkMode
   * @param linkMode
   */
  setLinkMode(linkMode) {
    const allowed_linkModes = "imported_file,imported_url,linked_file,linked_url".split(/,/);
    if (! allowed_linkModes.includes(linkMode) ) throw new Error("Invalid Argument, must be one of " + allowed_linkModes.join(", "));
    this.data.linkMode = linkMode;
  }

  /**
   *
   * @param {String} filepath
   */
  setFilepath(filepath) {
    if ( !filepath || ! typeof filepath === "string" || !fs.existsSync(filepath)) throw new Error(`File '${filepath}' is invalid or does not exist.`);
    this.filepath = filepath;
    let filename = path.basename(filepath);
    this.data.filename = filename;
    this.data.title = filename;
  }

  /**
   * Downloads the item template
   * @return {Promise<void>}
   */
  async downloadTemplate(itemType){
    if (!this.data.linkMode) throw new Error("You have to set the linkMode first");
    return (await library.client.get(`/items/new?itemType=${itemType}&linkMode=${this.data.linkMode}`)).data;
  }

  async upload() {
    if (!this.saved) {
      this.on("saved", () => this.upload());
      return;
    }
    Item.pendingUploads[this.data.key] = this;

    let fileStat = fs.statSync(this.filepath);
    let md5hash = require('md5-file').sync(this.filepath);
    let filename =  path.basename(this.filepath);
    let body = `md5=${md5hash}&filename=${filename}&filesize=${fileStat.size}&mtime=${fileStat.mtime.getTime()}`;

    let message = await library.client.post(
      library.path(`items/${this.data.key}/file`),
      {key: library.key},
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded',
        'If-None-Match': "*"
      }
    );
    let uploadConfig = message.data;
    if ( uploadConfig.exists ) {
      // File already uploaded
      delete Item.pendingUploads[this.data.key];
      return false;
    }

    // Create WriteStream
    let uploadSize = fileStat.size + uploadConfig.prefix.length + uploadConfig.suffix.length;
    let options = {
      url : uploadConfig.url,
      headers : {
        "Content-Type"   : uploadConfig.contentType,
        "Content-Length" : uploadSize
      }
    };
    let bytes = 0;
    await new Promise((resolve, reject) => {
      let writeStream = request.post(options)
      .on("error", reject)
      .on('response', function (response) {
        switch (response.statusCode) {
          case 201:
          case 204:
            console.log("Upload complete");
            return resolve();
          default:
            reject("Http Error " + response.statusCode + ": " + response.headers);
        }
      });
      // Create ReadStream and pipe into WriteStream
      const multiStream = require('multistream');
      const intoStream = require('into-stream');
      let streams = [
        intoStream(uploadConfig.prefix),
        fs.createReadStream(this.filepath),
        intoStream(uploadConfig.suffix)
      ];
      multiStream(streams)
      .on("error", reject)
      .on("data", (chunk) => {
        bytes += chunk.length;
        console.debug("Sent " +  bytes + " of " + uploadSize + " bytes of data.");
      })
      .pipe(writeStream);
    });

    //console.log("Registering upload...");
    message = await library.client.post(
      library.path(`items/${this.data.key}/file`),
      {key: library.key},
      `upload=${uploadConfig.uploadKey}`,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'If-None-Match': "*"
      }
    );
    delete Item.pendingUploads[this.data.key];
  }
}

/**
 * A queue of items to be sent to the server
 * @type {Item[]}
 */
Item.queue = [];

/**
 * A map of item templates
 * @type {{}}
 */
Item.templates = {};

/**
 * A list of uploads that still need to complete
 * @type {Attachment[]}
 */
Item.pendingUploads = {};

/**
 * Return the current sync version of the library
 * @todo There must be a better way than making a bogus request
 * @return {Promise<Number>}
 */
library.getVersion = async function(){
  return (await library.client.get(library.path('collections/top'),{ key:library.key, format: "versions" })).version;
};

module.exports = { library, Item, Note, Attachment };