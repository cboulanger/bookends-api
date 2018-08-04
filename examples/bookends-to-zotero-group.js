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
    this.bookendsModificationDates = {};
    this.bookendsUniqueIds = [];
    this.bookendsSyncData = {};
    this.bookendsModifiedIds = [];
    this.bookendsMissingAttachments = [];
    this.bookendsUnmodified = 0;
    this.bookendslibraryVersion = 0;
  }


  async synchronize(){
    await fixture.before();

    this.syncBookendsToZotero();

    this.syncZoteroToBookends();

    fixture.after();
  }

  async syncBookendsToZotero(){

    this.gauge.show(`Getting information on Bookends items...`, 0);
    await this.prepareBookendsSyncData();

    if (this.bookendsModifiedIds.length) {
      // save main reference data
      this.gauge.show(`Retrieving ${this.bookendsModifiedIds.length} changed or new Bookends references ...`,0);
      const bookends_fields = bookends.getFields();
      const bookends_items = await bookends.readReferences(this.bookendsModifiedIds, bookends_fields);
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

    // Success message
    console.log(`Exported ${zotero.Item.synchronized.length} items to Zotero (including notes and attachments), ${this.bookendsUnmodified} items were unchanged.`);

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
        if (! util.isObject(itemSyncData) || itemSyncData[syncID] === undefined) {
          return;
        }
        let modTime = this.bookendsModificationDates[index].getTime();
        let [syncTime, version, key] = (""+itemSyncData[syncID]).split(/,/);
        syncTime = parseInt(syncTime) || 0;

        // set bookends library version to the highest value found in the references
        if (version > this.bookendslibraryVersion){
          this.bookendslibraryVersion = version;
        }

        // we have an existing Zotero entry
        this.bookendsSyncData[item.uniqueID] = {
          syncTime, version, key
        };

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
  
  async saveBookendsItems(bookends_items_data) {
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
        //zotero_item_data.version = itemSyncData.version;
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

  async syncZoteroToBookends() {
    const bookends_version = 6501;
    const limit = 100;
    const message = await zotero.library.items({since: bookends_version, limit:0});
    const number_total = message.headers['total-results'];
    let number_downloaded = 0;
    let zotero_items_data = [];
    do {
      this.gauge.show(`Downloading zotero items ${number_downloaded}/${number_total}`, number_downloaded/number_total);
      let i = setInterval(() => this.gauge.pulse(),50);
      zotero_items_data = (await zotero.library.items({since: bookends_version, limit})).data;
      clearInterval(i);
      number_downloaded += zotero_items_data.length;
      for ( let [index, item] of zotero_items_data.entries()) {
        let zotero_item_data = item.data;
        let global_item_data = translate.toGlobal(dict.zotero, zotero_item_data);
        if (global_item_data.extra){
          let uniqueID = translate.unpack(global_item_data.extra).uniqueID;
        }
        let bookends_item_data = translate.toLocal(dict.bookends, global_item_data);
        this.dumpTranslationData(zotero_item_data,global_item_data,bookends_item_data, index);
      }
    } while(number_downloaded < number_total);
  }

}

(async () => {
  const synchronizer = new BookendsZoteroSynchronizer();
  try {
    //await synchronizer.sychronize();
    await synchronizer.syncZoteroToBookends();

  } catch (e) {
    console.error(e);
  }
})();