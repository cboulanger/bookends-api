/**
 * Script to synchronize a Bookends database with a Zotero group
 * Note: very hackish proof of concept, will change substantially
 */

// see readme.md first to configure the examples
require('dotenv').config();

const process  = require('process');
const bookends = require('../index');
const fixture = require('./fixture' );
const translate = require('./bibsync/translator');
const util = require('util');
const Gauge = require('gauge');
const zotero = require('./bibsync/zotero/zotero-api-plus');
const assert = require('assert');
const yargs = require('yargs');

// dictionary to translate from and to the different field schemas
let dict = {
  bookends: require('./bibsync/bookends/dictionary'),
  zotero: require('./bibsync/zotero/dictionary')
};

// constants that will be replaced by runtime arguments
const debug = false;
const resetSyncData = false;
const groupName = "all";
const BOOKENDS_SYNCDATA_FIELD = "user15";

class BookendsZoteroSynchronizer {

  constructor(library, sync_id){
    this.syncId = sync_id;// FIXME
    this.gauge = new Gauge();
    this.bookendsModificationDates = {};
    this.bookendsUniqueIds = [];
    this.bookendsSyncData = {};
    this.bookendsModifiedIds = [];
    this.bookendsMissingAttachments = [];
    this.bookendsUnmodified = 0;
    this.bookendslibraryVersion = 0;
    this.zoteroKeyToBookendsIds = {}
    this.zoteroCreatedItems=0;
    this.zoteroUpdatedItems=0;
  }


  /**
   * test method
   * @return {Promise<void>}
   */
  async test(){
    await fixture.before();
    await this.syncBookendsToZotero();
    await this.syncZoteroToBookends();
    fixture.after();
  }

  async syncBookendsToZotero(){

    if (this.bookendsModifiedIds.length) {
      // save main reference data
      this.gauge.show(`Retrieving ${this.bookendsModifiedIds.length} changed or new Bookends references ...`,0);
      const bookends_fields = bookends.getFields();
      const bookends_items = await bookends.readReferences(this.bookendsModifiedIds, bookends_fields);
      await this.saveBookendsItemsInZotero(bookends_items);

      // save remaining items (notes and attachments)
      this.gauge.show(`Sending remaining items data to Zotero server...`,1);
      await zotero.Item.sendAll();
      // pending uploads
      if (zotero.Item.hasPendingUploads()){
        this.gauge.show(`Waiting for pending uploads ...`,1);
        await zotero.Item.waitForPendingUploads();
      }
    }

    // Success message
    console.log(`Synchronized ${zotero.Item.synchronized.length} items with Zotero library (including notes and attachments), creating ${this.zoteroCreatedItems} and updating ${this.zoteroUpdatedItems} items.`);

    // Problems
    if (this.bookendsMissingAttachments.length){
      console.error("The following attachments were not found and could not be uploaded:\n - " +
      this.bookendsMissingAttachments.join("\n - "));
    }
    if (zotero.Item.failedRequests.length){
      console.error("The following errors occurred when saving items to the Zotero server:");
      console.error(zotero.Item.failedRequests);
    }

    this.gauge.hide();
  }

  async prepareBookendsSyncData(){
    this.gauge.show(`Getting information on Bookends items...`, 0);
    this.bookendsUnmodified = 0;
    this.bookendsModifiedIds = [];
    this.zoteroKeyToBookendsIds = {};
    this.bookendsUniqueIds = await bookends.getGroupReferenceIds(groupName);
    this.bookendsModificationDates = await bookends.modificationDates(this.bookendsUniqueIds);
    this.bookendsSyncData = await bookends.readReferences(this.bookendsUniqueIds, ['uniqueID',BOOKENDS_SYNCDATA_FIELD], false);
    this.bookendsSyncData.forEach((item, index) => {
      // check modification and sync date
      let itemSyncData = item[BOOKENDS_SYNCDATA_FIELD] || "";
      if ( ! resetSyncData && itemSyncData) {
        // parse sync data from item
        try {
          itemSyncData = JSON.parse(itemSyncData.replace(/'/g,'"'));
        } catch (e) {
          return;
        }
        if (! util.isObject(itemSyncData) || itemSyncData[this.syncId] === undefined) {
          return;
        }
        let modTime = this.bookendsModificationDates[index].getTime();
        let [syncTime, version, key] = (""+itemSyncData[this.syncId]).split(/,/);
        syncTime = parseInt(syncTime) || 0;

        // set bookends library version to the highest value found in the references
        if (version > this.bookendslibraryVersion){
          this.bookendslibraryVersion = parseInt(version);
        }

        // we have an existing Zotero entry
        this.bookendsSyncData[item.uniqueID] = {
          syncTime, version, key
        };
        this.zoteroKeyToBookendsIds[key] = item.uniqueID;

        // if modification time (which will be the  time when the sync data is saved to the reference)
        // is not later than 100 seconds since the synchronization time, consider unmodified.
        // This long time lag is necessary because of asynchronicity of saving the timestamp in the bookends database

        //console.log([new Date(modTime).toUTCString(),new Date(syncTime).toUTCString()]);
        //console.log(modTime - syncTime);
        if (modTime - syncTime < 100000  ) {
          this.bookendsUnmodified++;
          return;
        }
      }
      this.bookendsModifiedIds.push(item.uniqueID);
    });
  }

  async saveBookendsItemsInZotero(bookends_items_data) {
    this.zoteroCreatedItems=0;
    this.zoteroUpdatedItems=0;
    const total = bookends_items_data.length;

    // main loop
    for (let [index, bookends_item_data] of bookends_items_data.entries() ) {

      // translate
      let global_item_data = translate.toGlobal(dict.bookends, bookends_item_data);
      let zotero_item_data = translate.toLocal(dict.zotero, global_item_data);

      // add missing creators
      if ( ! zotero_item_data.creators ){
        zotero_item_data.creators = [{ name: "Anonymous", creatorType: "author"}];
      }

      // check if item has already been synchronized
      let itemSyncData = this.bookendsSyncData[bookends_item_data.uniqueID];
      if (itemSyncData !== undefined) {
        zotero_item_data.key = itemSyncData.key;
        this.zoteroUpdatedItems++;
      } else {
        this.zoteroCreatedItems++;
      }


      if (debug) {
        this.dumpTranslationData(bookends_item_data,global_item_data,zotero_item_data, index);
      } else {

        // create item model
        const item = new zotero.Item(zotero_item_data.itemType);
        // save the bookends data
        item.sourceData = bookends_item_data;
        await item.set(zotero_item_data);
        // notes, upload only if item doesn't exist yet
        // @todo download & compare notes
        if (zotero_item_data.notes && !zotero_item_data.key) {
          let note = new zotero.Note(zotero_item_data.notes, item);
          note.save(true);// this is async, doesn't block
        }
        // attachments, upload only if item doesn't exist yet
        // @todo download & compare attachments
        if (zotero_item_data.attachments && !zotero_item_data.key) {
          zotero_item_data.attachments.split(/;/).forEach(filename => {
            let filepath = process.env.BOOKENDS_ATTACHMENT_PATH + "/" + filename.trim();
            try {
              let attachment = new zotero.Attachment(filepath, "imported_file", item);
              attachment.save(true); // async
              attachment.upload(); // async, will upload when it is saved
            } catch (e) {
              this.bookendsMissingAttachments.push(filename);
            }
          });
        }

        // start saving
        await item.save(true);
        this.gauge.show(`Processed ${index}/${total} references (${zotero.Item.failedRequests.length} errors).`, index/total);
        this.gauge.pulse();

        // this causes a small delay so that the this.gauge can be seen
        await new Promise(resolve => setTimeout( () => resolve(), 25));

        // send saved items to server in batches of 50
        if (index % 50===0){
          this.gauge.show(`Synchronizing data with servers...`, index/total);
          let i = setInterval(() => this.gauge.pulse(),50);
          let savedItems = await zotero.Item.sendAll();
          clearInterval(i);
          this.saveBookendsSyncData(savedItems);
        }
      }
    }
  }

  dumpTranslationData(source,global,target, index) {
    console.log(`================= Source item #${index} =================`);
    console.log(source);
    console.log(`================= Global item #${index} =================`);
    console.log(global);
    console.log(`================= Target item #${index} =================`);
    console.log(target);
  }

  /**
   * Saves the Bookends sychonization data for the given Zotero items
   * @param {Item[]} items
   * @return {Promise<void>}
   */
  async saveBookendsSyncData(items) {
    let timestamp = Date.now();
    let version = zotero.Item.version;
    let data = items
    .filter(item => item.sourceData !== undefined)
    .map(item => {
      let data = this.updateBookendsSyncDataField(item.sourceData, timestamp, version, item.data.key, true);
      // we need only uniqueID and
    });
    if (data.length){
      try {
        await bookends.updateReferences(data);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /**
   * Returns the bookends item data with an updated synchronization data field
   * @param {{}} bookendsItemData
   * @param {Number} timestamp
   * @param {Number} zoteroVersion
   * @param {String} zoteroKey
   * @param {Boolean} syncDataOnly If true, remove all fields except uniqueID and the sync data
   * @return {{}}
   */
  updateBookendsSyncDataField(bookendsItemData, timestamp, zoteroVersion, zoteroKey, syncDataOnly=false) {
    let defaultData = {'Synchronization data':'DO NOT MODIFY THIS FIELD!'};
    let itemSyncData = bookendsItemData[BOOKENDS_SYNCDATA_FIELD];
    if ( resetSyncData || ! itemSyncData ) {
      // reset all synchronization data or initialize empty field
      itemSyncData = defaultData;
    } else {
      try {
        itemSyncData = JSON.parse(itemSyncData.replace(/'/g, '"'));
      } catch (e) {
        // pass to finally
      } finally {
        if (! itemSyncData || typeof itemSyncData !== "object") {
          // invalid content
          itemSyncData = defaultData;
        }
      }
    }
    itemSyncData[this.syncId] = [timestamp, zoteroVersion, zoteroKey].join(',');
    bookendsItemData[BOOKENDS_SYNCDATA_FIELD] = JSON.stringify(itemSyncData).replace(/"/g,"'");
    if (syncDataOnly){
      Object.getOwnPropertyNames(bookendsItemData).map(name => {
        if (!['uniqueID',BOOKENDS_SYNCDATA_FIELD].includes(name)) delete bookendsItemData[name];
      });
    }
    return bookendsItemData;
  }

  async syncZoteroToBookends() {
    let bookends_library_version = this.bookendslibraryVersion;

    // sync deletions
    //let keysDeleted = await zotero.library.get('deleted',{since: bookends_version});

    // synchronize existing
    const limit = 100;
    const message = await zotero.Item.library.items({since: bookends_library_version, limit:0}); // fixme
    const number_total = parseInt(message.headers['total-results']);
    let zotero_library_version = message.version;
    let number_retrieved = 0;
    let zotero_items_data = [];
    if (number_total===0) {
      console.info("Bookends library is up to date.");
      return;
    }
    let number_updated = 0;
    let number_created = 0;
    do {
      this.gauge.show(`Retrieving zotero items ${number_retrieved}/${number_total}`, number_retrieved/number_total);
      let i = setInterval(() => this.gauge.pulse(),50);
      let message = await zotero.Item.library.items({since: bookends_library_version, limit}); //fixme
      zotero_items_data = message.data;
      clearInterval(i);
      number_retrieved += zotero_items_data.length;
      const syncTimestamp = Date.now();
      for ( let [index, item] of zotero_items_data.entries()) {
        let zotero_item_data = item.data;
        if( ['note','attachment'].includes(zotero_item_data.itemType)){
          // not downloading notes and attachments
          continue;
        }

        let global_item_data = translate.toGlobal(dict.zotero, zotero_item_data);
        let bookends_item_data = translate.toLocal(dict.bookends, global_item_data);
        if (debug) {
          this.dumpTranslationData(zotero_item_data,global_item_data,bookends_item_data, index);
        }
        bookends_item_data = this.updateBookendsSyncDataField(bookends_item_data, syncTimestamp, zotero_library_version, zotero_item_data.key);

        let zotero_key = parseInt(this.zoteroKeyToBookendsIds[zotero_item_data.key]);
        let bookends_id = zotero_key || parseInt(translate.unpack(global_item_data.extra)['bookends-uniqueId']);

        if (bookends_id) {
          // update reference
          bookends_item_data.uniqueID = bookends_id;
          await bookends.updateReferences([bookends_item_data]);
          number_updated++;
        } else {
          // create new reference
          bookends.addReferences([bookends_item_data]);
          number_created++;
        }
      }
    } while(++number_retrieved < number_total);
    this.gauge.hide();
    console.info(`Updated ${number_updated} and created ${number_created} references.`);
  }
}


let argv = yargs
  .usage('$0 <path> [options]', 'Synchronizes a Bookends database with a Zotero library.', (yargs) => {
    yargs.positional('path', {
      describe: 'the path to the zotero library, either groups/<group id> or user/<user id>.',
      type: 'string'
    })
  })
  .options({
    "target":{
      describe: 'If given, do only one-way sync to target',
      type: "string"
    },
    "key":{
      describe: 'The zotero API key, if not provided as the environment variable ZOTERO_API_KEY.',
      type: "string"
    }
    // ,
    // "verbose":{
    //   alias : "v",
    //   describe: 'Verbose logging'
    // }
  })
  .showHelpOnFail()
  .argv;

let options = {
  key: process.env.ZOTERO_API_KEY || argv.key
};
let [prefix,id] = argv.path.split(/\//);
if (! id || isNaN(parseInt(id)) ) prefix= null;
let sync_id; // fixme

switch (prefix) {
  case "groups":
    options['group'] = id;
    sync_id = "zotero:group:"+id;
    break;
  case "users":
    options['user'] = id;
    sync_id = "zotero:user:"+id;
    break;
  default:
    console.error("Invalid path: must be either groups/<group id> or user/<user id>");
    process.exit(1);
}

const library = new zotero.Library(options);
zotero.Item.library = library; //FIXME

const synchronizer = new BookendsZoteroSynchronizer(library,sync_id);
(async() =>{
  await synchronizer.prepareBookendsSyncData();
  switch (argv.target) {
    case "zotero":
      await synchronizer.syncBookendsToZotero();
      break;
    case "bookends":
      await synchronizer.syncZoteroToBookends();
      break;
    case undefined:
      await synchronizer.syncBookendsToZotero();
      await synchronizer.syncZoteroToBookends();
      break;
    default:
      console.error("Invalid target: must be either bookends, zotero or not provided.");
      process.exit(1);
  }
})().catch(e => console.error(e));