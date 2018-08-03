/**
 * Script to 1) display, 2) find and 3) attach (2 & 3 not yet implemented) missing attachments
 */

// see readme.md first to configure the examples
require('dotenv').config();

const bookends = require('../index');
const fixture = require('./fixture' );
const util = require('util');
const process  = require('process');
const Gauge = require('gauge');
const fs = require('fs');
const child_process = require('child_process');

const bookends_attachment_path = process.env.BOOKENDS_ATTACHMENT_PATH;

(async () => {

let gauge = new Gauge();

gauge.show("Retrieving references with attachments",0);
let ids = await bookends.getGroupReferenceIds('attachments');
let data = await bookends.readReferences(ids, ['uniqueID','attachments']);
let total = data.length;
const missing = {};
for (let [index, item] of data.entries()) {
  gauge.show(`Looking for references with missing attachments (${index}/${total})...`, index/total);
  if (! item.attachments) return;
  gauge.pulse();
  for (let filename of item.attachments.split(/\n/)) {
    let path = bookends_attachment_path + "/" + filename;
    if (! fs.existsSync(path)){
      missing[filename]  = await new Promise( (resolve, reject) => {
        child_process.exec(`mdfind -name "${filename}"`, null, (err,stdout,stderr) =>{
          if (err) reject(err);
          resolve(stdout);
        });
      });
    }
  }

}
gauge.hide();
console.log(`Found ${missing.length} missing attachments out of ${total}`);
console.log(missing);

})().catch(e => console.error(e));

