/**
 * Script to copy a Bookends database to a Zotero group
 * Note: very hackish proof of concept, needs to be abstracted and refactored into proper classes
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

const BOOKENDS_SYNCDATA_FIELD = "user15";
let syncID = "zotero:group:" + process.env.ZOTERO_GROUP_ID;

// dictionary to translate from and to the different field schemas
let dict = {
  bookends: require('./bibsync/bookends/dictionary'),
  zotero: require('./bibsync/zotero/dictionary')
};

// static runtime constants
const debug = false;
const max = 0;
const resetSyncData = false;

// closure vars
let index=0;
let missing_attachments = [];
let unmodified = 0;

(async()=>{
  try {
    await fixture.before();
    const gauge = new Gauge();

    gauge.show(`Getting information on Bookends and Zotero items...`);

    const bookends_fields = bookends.getFields();
    const allIds = await bookends.getGroupReferenceIds('all');
    const modificationDates = await bookends.modificationDates(allIds);
    let bookends_items = await bookends.readReferences(allIds, bookends_fields);
    const total = bookends_items.length;

    let zotero_items_versions = await zotero.Item.getVersions();

    gauge.show(`Retrieving ${allIds.length} Bookends references ...`, 0);

    // main loop
    for (let [index, bookends_item_data] of bookends_items.entries() ) {

      // max number (for testing large libraries
      if( max && index > max) break;

      // translate
      let global_item_data = translate.toGlobal(dict.bookends, bookends_item_data);
      let zotero_item_data = translate.toLocal(dict.zotero, global_item_data);

      // add missing creators
      if ( ! zotero_item_data.creators ){
        zotero_item_data.creators = [{ name: "Anonymous", creatorType: "author"}];
      }

      // check modification and sync date
      let syncData = bookends_item_data[BOOKENDS_SYNCDATA_FIELD];
      if ( ! resetSyncData && syncData !== undefined){
        syncData = JSON.parse(syncData.replace(/'/g,'"'));
        let modTime = modificationDates[index].getTime();
        let [syncTime, version, key] = (""+syncData[syncID]).split(/,/);
        // unmodified in Bookends
        if (modTime <= syncTime) {
          unmodified++;
          continue;
        }
        // we have an existing Zotero entry
        zotero_item_data.key = key;
        zotero_item_data.version = version;
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
        if (zotero_item_data.notes && !zotero_item_data.key) {
          let note = new zotero.Note(zotero_item_data.notes, item);
          note.save(true);// this is async, doesn't block
        }
        // attachments, upload only if item doesn't exist yet
        if (zotero_item_data.attachments && !zotero_item_data.key) {
          zotero_item_data.attachments.split(/;/).forEach(filename => {
            let filepath = process.env.BOOKENDS_ATTACHMENT_PATH + "/" + filename.trim();
            try {
              let attachment = new zotero.Attachment(filepath, "imported_file", item);
              attachment.save(true); // async
              attachment.upload(); // async, will upload when it is saved
            } catch (e) {
              missing_attachments.push(filename);
            }
          });
        }

        // start saving
        await item.save(true);
        gauge.show(`Saved ${index}/${total} references.`, index/total);

        // this causes a small delay so that the gauge can be seen
        await new Promise(resolve => setTimeout( () => resolve(), 50));
        // send saved items to server in batches of 50
        if (index % 50===0){
          gauge.show(`Sending data to Zotero server...`, index/total);
          await zotero.Item.sendAll();
        }
      }
    }
    gauge.show(`Sending remaining items data to Zotero server...`);
    await zotero.Item.sendAll();
    if (zotero.Item.hasPendingUploads()){
      gauge.show(`Waiting for pending uploads ...`);
      await zotero.Item.waitForPendingUploads();
    }

    // save synchronization data
    let numberSuccessful = zotero.Item.synchronized.length;
    if (numberSuccessful > 0){
      const libraryVersion = await zotero.library.getVersion();
      const syncTime = Date.now();
      gauge.show(`Saving synchronization data to bookends... `);
      let data = zotero.Item.synchronized.filter(item => item.sourceData !== undefined).map(item => {
        let defaultData = {'Synchronization data':'DO NOT MODIFY THIS FIELD!'};
        let syncData = item.sourceData[BOOKENDS_SYNCDATA_FIELD];
        if ( ! resetSyncData && syncData !== undefined){
          try {
            syncData = JSON.parse(syncData.replace(/'/g,'"'));
            if (!syncData || syncData !== "object" ){
              syncData = defaultData;
            }
          } catch (e) {
            syncData = defaultData;
          }
        } else {
          syncData = defaultData;
        }
        syncData[syncID] = [syncTime,libraryVersion,item.data.key].join(',');
        return {
          'uniqueID': item.sourceData.uniqueID,
          'user15' : JSON.stringify(syncData).replace(/"/g,"'")
        };
      });
      try {
        await bookends.updateReferences(data);
      } catch (e) {
        console.error(e);
      }
    }
    gauge.hide();
    console.log(`Exported ${numberSuccessful} items to Zotero (including notes and attachments), ${unmodified} items were unchanged.`);
    if(missing_attachments.length){
      console.error("The following attachments were not found and could not be uploaded:\n" +
        missing_attachments.join("\n - "));
    }
    if (zotero.Item.failedRequests.length){
      console.error("The following errors occurred when saving items to the Zotero server:");
      console.error(Item.failedRequests);
    }
    fixture.after();
  }catch(e){ console.error(e);}
})();