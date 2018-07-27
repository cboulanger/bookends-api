/* global describe, it */

const bookends = require( __dirname + '/../index');
const assert = require('assert');
const util = require('util');

describe('Bookends', async function() {
  //this.timeout(2000);

  it('should report its version number', async () => {
    let version = await bookends.getVersion();
    assert( util.isString(version), "Version is not a string." );
    assert( parseInt(version) > 12, "Version must be greater than 12");
  }); 
});