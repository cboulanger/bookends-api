/**
 * Script to find missing attachments and copy them into the attachment folder
 */

// see readme.md first to configure the examples
require('dotenv').config();

const bookends = require('../index');
const fixture = require('./fixture' );
const util = require('util');
const path = require('path');
const process  = require('process');
const Gauge = require('gauge');
const fs = require('fs');
const child_process = require('child_process');
const osascript = require('node-osascript');

// from .env file
const bookends_attachment_path = path.resolve(process.env.BOOKENDS_ATTACHMENT_PATH);

// the following constants will be replaced by command line arguments

// set the maximal number of downloads from icloud (i.e. on a machine with low internet bandwith)
// to disable, set to 0
const icloud_max_download = 0;

// whether to output debug messsages
const debug = false;

(async () => {

let gauge = new Gauge();

gauge.show("Retrieving references with attachments",0);
let ids = await bookends.getGroupReferenceIds('attachments');
let data = await bookends.readReferences(ids, ['uniqueID','attachments']);
let total = data.length;
const icloud_downloads_in_progress = {};
const icloud_downloaded = [];
const icloud_not_downloaded = [];
const missing = {};
const found = [];
const notfound = [];

for (let [index, item] of data.entries()) {
  gauge.show(`Looking for references with missing attachments (${index}/${total})...`, index/total);
  if (! item.attachments) return;
  gauge.pulse();

  for (let attachment_name of item.attachments.split(/\n/)) {
    // check if file exists
    let attachment_path = bookends_attachment_path + "/" + attachment_name;
    let attachment_icloud_path = bookends_attachment_path + "/." + attachment_name + ".icloud";
    if ( fs.existsSync(attachment_path) || fs.existsSync(attachment_icloud_path)) {
      // all good, attachment is there, either as the real file or a reference to the file in iCloud
      continue;
    }
    // file is missing
    missing[attachment_name] = true;
    // look for files using the spotlight index
    let filepaths = await new Promise( (resolve, reject) => {
      child_process.exec(`mdfind -name "${attachment_name}"`, null, (err,stdout,stderr) =>{
        if (err) return reject(err);
        if (!stdout || !stdout.trim()) resolve(false);
        resolve(stdout.split(/\n/).filter(item => item.trim()));
      });
    });

    // insert here: additional locations to search files in

    // no file found
    if (! (Array.isArray(filepaths) && filepaths.length)) {
      if (debug) console.log(` >>> Found no files for missing attachment ${attachment_name}`);
      notfound.push(attachment_name);
      continue;
    }
    // we have some candidates
    if (debug) console.log(` >>> Found ${filepaths.length} possible files for missing attachment ${attachment_name}`);
    for (let filepath of filepaths){

      if ( ! filepath.normalize().includes(attachment_name.normalize())) {
        if (debug) console.log(` >>> Skipping ${filepath.normalize()} since it doesn't include the name of the attachment...`);
        continue;
      }

      if (filepath.endsWith(".icloud") ){
        if ( icloud_max_download && Object.getOwnPropertyNames(icloud_downloads_in_progress).length > icloud_max_download) {
          if (debug) console.log(` >>> Skipping ${attachment_name}.`);
          icloud_not_downloaded.push(attachment_name);
          continue;
        }

        // open in Preview (this will implicitly download it from icloud)
        if (debug) console.log(` >>> Downloading ${filepath}...`);
        icloud_downloads_in_progress[filepath] = attachment_name;
        try {
          let result = await new Promise((resolve, reject) => {
            let cmd = `tell application "Preview"
              open POSIX file "${filepath}"
              delay 1
              close
            end tell`;
            osascript.execute(cmd, {}, (err, result) =>{
              if (err) return eject(err);
              resolve(result);
            });
          });
          found.push(attachment_name);
        } catch (e) {
          console.error(e);
          delete icloud_downloads_in_progress[filepath];
        }
      } else {
        try {
          await new Promise( (resolve, reject) => {
            fs.copyFile(filepath, attachment_path,null, err => {
              if(err) return reject(err);
              resolve();
            });
          });
          if (debug) console.log(` >>> Done copying ${filepath} into attachment folder.`);
          found.push(attachment_name);
        } catch (e) {
          if (debug) console.log(` >>> Errror copying ${filepath}  into attachment folder: ${e}`);
        }
      }
    }
  }
}
while (Object.getOwnPropertyNames(icloud_downloads_in_progress).length){
  gauge.show(`Waiting for ${icloud_downloads_in_progress.length} icloud downloads to finish`);
  for ( let [filepath, attachment_name] of Object.entries(icloud_downloads_in_progress)) {
    if( ! fs.existsSync(filepath) ){
      // file has been downloaded
      delete icloud_downloads_in_progress[filepath];
      icloud_downloaded.push(attachment_name);
    }
  }
  await new Promise(resolve => setTimeout( () => resolve(), 1000));
}
gauge.hide();
// info
if (found.length) {
  console.info(`\nFound ${found.length} missing attachments out of ${Object.getOwnPropertyNames(missing).length}:`);
  console.info(found);
}

if (notfound.length) {
  console.info(`\nThe following files could not be found:`);
  console.info(notfound);
}
if (icloud_downloaded.length) {
  console.info(`\nThe following files were found in iCloud Drive and have been downloaded. Plese run the script again to copy them into the attachment folder.`);
  console.info(icloud_downloaded);
}

if (icloud_not_downloaded.length){
  console.info(`\nThe following files were found in iCloud Drive but were not downloaded:`);
  console.info(icloud_not_downloaded);
}

})().catch(e => console.error(e));