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
const zotero = require('./bibsync/zotero/zotero-enhanced');

// dictionary to translate from and to the different field schemas
let dict = {
  bookends: require('./bibsync/bookends/dictionary'),
  zotero: require('./bibsync/zotero/dictionary')
};

const debug = false, max = 10;
let i=0;

(async()=>{
  try {
    await fixture.before();
    const allIds = await bookends.getGroupReferenceIds('all');
    const bookends_fields = bookends.getFields();
    console.log(` >>> Retrieving ${allIds.length} references ...`);
    let bookends_items = await bookends.readReferences(allIds, bookends_fields);
    const gauge = new Gauge();
    const total = bookends_items.length;
    for (let bookends_item of bookends_items) {
      let global_item = translate.toGlobal(dict.bookends, bookends_item);
      let zotero_item = translate.toLocal(dict.zotero, global_item);
      i++;
      if( max && i>max) break;
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
        await item.save();
        //gauge.show(`Saved ${i}/${total} references to Zotero group`, i/total);
      }
    }
    fixture.after();
  }catch(e){ console.error(e);}
})();