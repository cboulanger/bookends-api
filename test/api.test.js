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

  it('should list unique ids of references contained in groups', async () => {
    let allRefIds = await bookends.getGroupReferenceIds('All');
    assert( util.isArray(allRefIds), "Method did not return an Array");
    assert.equal( allRefIds.length, 11, "Incorrect number of total references." );
    let idsInFoo1 = await bookends.getGroupReferenceIds('foo1');
    assert.equal( idsInFoo1.length, 2);
  }); 


  it('should find references using an sql query', async () => {
    let refIds = await bookends.search("title REGEX 'Bibliographic'");
    assert( util.isArray(refIds), "Method did not return an Array");
    assert.equal( refIds.length, 6, "Incorrect number of found references." );
  });   
  //
});