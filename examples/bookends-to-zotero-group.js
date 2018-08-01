/**
 * Script to copy a Bookends database to a Zotero group
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

const debug = false;
const max = 0;
let i=0;
let missing_attachments = [];

(async()=>{
  try {
    await fixture.before();
    const gauge = new Gauge();
    const bookends_fields = bookends.getFields();
    const allIds = await bookends.getGroupReferenceIds('all');
    gauge.show(`Retrieving ${allIds.length} references ...`, 0);
    let bookends_items = await bookends.readReferences(allIds, bookends_fields);
    const total = bookends_items.length;
    for (let bookends_item of bookends_items) {
      let global_item = translate.toGlobal(dict.bookends, bookends_item);
      let zotero_item = translate.toLocal(dict.zotero, global_item);
      if( ! zotero_item.creators ){
        zotero_item.creators = [{ name: "Anonymous", creatorType: "author"}];
      }
      i++;
      if( max && i > max) break;
      if (debug ) {
        //console.log(` >>> Bookends item:`);
        //console.log(bookends_item);
        console.log(` >>> Global item:`);
        console.log(global_item);
        console.log(` >>> Zotero item:`);
        console.log(zotero_item);
      } else {
        let item = new zotero.Item(zotero_item.itemType);
        await item.set(zotero_item);
        // notes
        if (zotero_item.notes) {
          let note = new zotero.Note(zotero_item.notes, item);
          note.save(true);// this is async, doesn't block
        }
        if (zotero_item.attachments) {
          zotero_item.attachments.split(/;/).forEach(filename => {
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
        await item.save(true);
        i++;
        if (i % 50===0){
          gauge.show(`Sending data to Zotero server`, i/total);
          await zotero.Item.sendAll();
        }
        gauge.show(`Saved ${i}/${total} references to Zotero`, i/total);
        // this causes a small delay so that the gauge can be seen
        await new Promise(resolve => setTimeout( () => resolve(), 50));
      }
    }
    gauge.show(`Sending remaining items data to Zotero server ...`);
    await zotero.Item.sendAll();
    if (zotero.Item.hasPendingUploads()){
      gauge.show(`Waiting for pending uploads ...`);
      await zotero.Item.waitForPendingUploads();
    }
    gauge.hide();
    console.log(`Exported ${total} references to Zotero.`);
    if(missing_attachments.length){
      console.log("The following attachments were not found and could not be uploaded:\n" + missing_attachments.join("\n - "));
    }
    fixture.after();
  }catch(e){ console.error(e);}
})();