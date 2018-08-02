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
const syncID = "zotero:group:" + process.env.ZOTERO_GROUP_ID;

class BookendsZoteroSynchronizer {

  constructor(){
    this.gauge = new Gauge();
    this.modificationDates = {};
    this.ids = [];
    this.syncData = {};
    this.modifiedIds = [];
    this.missing_attachments = [];
    this.unmodified = 0;
    this.bookendslibraryVersion = 0;
  }

  async sychronize(){
    await fixture.before();

    this.gauge.show(`Getting information on Bookends and Zotero items...`, 0);

    await this.init();

    // Bookends
    if (this.modifiedIds.length) {
      // save main reference data
      this.gauge.show(`Retrieving ${this.modifiedIds.length} changed or new Bookends references ...`,0);
      const bookends_fields = bookends.getFields();
      const bookends_items = await bookends.readReferences(this.modifiedIds, bookends_fields);
      await this.saveBookendsItems(bookends_items);

      // save remaining items (notes and attachments)
      this.gauge.show(`Sending remaining items data to Zotero server...`,1);
      await zotero.Item.sendAll();
      // pending uploads
      if (zotero.Item.hasPendingUploads()){
        this.gauge.show(`Waiting for pending uploads ...`,1);
        await zotero.Item.waitForPendingUploads();
      }
    }

    this.gauge.hide();

    // Success message
    console.log(`Exported ${zotero.Item.synchronized.length} items to Zotero (including notes and attachments), ${this.unmodified} items were unchanged.`);

    // Problems
    if (this.missing_attachments.length){
      console.error("The following attachments were not found and could not be uploaded:\n" +
      this.missing_attachments.join("\n - "));
    }
    if (zotero.Item.failedRequests.length){
      console.error("The following errors occurred when saving items to the Zotero server:");
      console.error(zotero.Item.failedRequests);
    }

    //const zotero_item_data = await zotero.Item.getItemDataModifiedSinceVersion(this.bookendslibraryVersion);
    //console.log(zotero_item_data);
    //

    fixture.after();
  }

  async init(){
    this.ids = await bookends.getGroupReferenceIds(groupName);
    this.modificationDates = await bookends.modificationDates(this.ids);
    this.syncData = await bookends.readReferences(this.ids, ['uniqueID',BOOKENDS_SYNCDATA_FIELD], false);
    this.syncData.forEach((item,index) => {
      // check modification and sync date
      let itemSyncData = item[BOOKENDS_SYNCDATA_FIELD] || "";
      if ( ! resetSyncData && itemSyncData) {
        // parse sync data from item
        try {
          itemSyncData = JSON.parse(itemSyncData.replace(/'/g,'"'));
        } catch (e) {
          return;
        }
        if (! util.isObject(itemSyncData) || itemSyncData[syncID] === undefined) {
          return;
        }
        let modTime = this.modificationDates[index].getTime();
        let [syncTime, version, key] = (""+itemSyncData[syncID]).split(/,/);
        syncTime = parseInt(syncTime) || 0;

        // set bookends library version to the highest value found in the references
        if (version > this.bookendslibraryVersion){
          this.bookendslibraryVersion = version;
        }

        // we have an existing Zotero entry
        this.syncData[item.uniqueID] = {
          syncTime, version, key
        };

        // if sync time and modification time differ by no more than one second, assume unmodified
        console.log([new Date(modTime).toUTCString(),new Date(syncTime).toUTCString()]);
        if (modTime - syncTime < 1000  ) {
          this.unmodified++;
          return;
        }
      }
      this.modifiedIds.push(item.uniqueID);
    });
  }
  
  async saveBookendsItems(bookends_items) {
    const total = bookends_items.length;

    // main loop
    for (let [index, bookends_item_data] of bookends_items.entries() ) {

      // translate
      let global_item_data = translate.toGlobal(dict.bookends, bookends_item_data);
      let zotero_item_data = translate.toLocal(dict.zotero, global_item_data);

      // add missing creators
      if ( ! zotero_item_data.creators ){
        zotero_item_data.creators = [{ name: "Anonymous", creatorType: "author"}];
      }

      // check if item has already been synchronized
      let itemSyncData = this.syncData[bookends_item_data.uniqueID];
      if (itemSyncData !== undefined) {
        zotero_item_data.key = itemSyncData.key;
        //zotero_item_data.version = itemSyncData.version;
      }

      if (debug) {
        // output data only, do not upload
        console.log(`================= Bookends item #${index} =================`);
        console.log(bookends_item_data);
        console.log(`================= Global item #${index} =================`);
        console.log(global_item_data);
        console.log(`================= Zotero item #${index} =================`);
        console.log(zotero_item_data);
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
              this.missing_attachments.push(filename);
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

  /**
   *  Saves the Bookends sychonization data for the given Zotero items
   * @param {Item[]} items
   * @return {Promise<void>}
   */
  async saveBookendsSyncData(items) {
    let data = items
    .filter(item => item.sourceData !== undefined)
    .map(item => {
      let defaultData = {'Synchronization data':'DO NOT MODIFY THIS FIELD!'};
      let itemSyncData = item.sourceData[BOOKENDS_SYNCDATA_FIELD];
      if ( ! resetSyncData && itemSyncData !== undefined){
        try {
          itemSyncData = JSON.parse(itemSyncData.replace(/'/g,'"'));
          if (!itemSyncData || itemSyncData !== "object" ){
            itemSyncData = defaultData;
          }
        } catch (e) {
          itemSyncData = defaultData;
        }
      } else {
        itemSyncData = defaultData;
      }
      let key = item.data.key;
      itemSyncData[syncID] = [Date.now(), zotero.Item.version, key].join(',');
      return {
        'uniqueID': item.sourceData.uniqueID,
        [BOOKENDS_SYNCDATA_FIELD] : JSON.stringify(itemSyncData).replace(/"/g,"'")
      };
    });
    if (data.length){
      try {
        await bookends.updateReferences(data);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

(async () => {
  const synchronizer = new BookendsZoteroSynchronizer();
  try {
    await synchronizer.sychronize();
  } catch (e) {
    console.error(e);
  }
})();