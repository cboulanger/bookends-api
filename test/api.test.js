/* global describe, it, beforeEach, afterEach */

const bookends = require( __dirname + '/../index');
const fixture = require( __dirname + '/fixture' );
const assert = require('assert');
const util = require('util');


describe('Bookends', async function() {
  this.timeout(20000);
  before(fixture.before);
  after(fixture.after);
  
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
    let refIds = await bookends.searchReferences("title REGEX 'Bibliographic'");
    assert( util.isArray(refIds), "Method did not return an Array");
    assert.equal( refIds.length, 6, "Incorrect number of found references." );
  });   

  it('should return formatted references', async () => {
    let result = await bookends.formatReferences([41103,57913], "APA 6th Edition",false);
    assert( util.isArray(result), "Method did not return an Array");
    assert.equal( result.length, 2 );
    let expected = [ 
      'Dempsey, L. (1990). Bibliographic access in Europe : first international conference. Aldershot, Hants, England; Brookfield, Vt., USA: Gower.',
      'Willer, M., & Dunsire, G. (2013). Bibliographic information organization in the semantic web. Oxford: Chandos Pub.'
    ];
    assert.deepStrictEqual(result, expected);
  });    
  
  it('should return a list of groups', async () => {
    let result = await bookends.getGroupNames();
    assert( util.isArray(result), "Method did not return an Array");
    assert.deepStrictEqual(result, [ 'Bar', 'bar1', 'bar2', 'Baz', 'baz1', 'Foo', 'foo1', 'foo2' ]);
    result = await bookends.getGroupNames(true);
    assert( util.isArray(result), "Method did not return an Array");
    assert.deepStrictEqual(result, [ 
      'Bar',
      'Bar/bar1',
      'Bar/bar2',
      'Bar/Baz',
      'Bar/Baz/baz1',
      'Foo',
      'Foo/foo1',
      'Foo/foo2'
     ]);
  });

  it('should create a static group', async () => {
    let groupName = "boo1";
    let idsInFoo1 = await bookends.getGroupReferenceIds('foo1');
    let createdGroupName = await bookends.createStaticGroup(groupName, idsInFoo1 );
    assert.equal( createdGroupName, groupName);
    let idsInBoo1 = await bookends.getGroupReferenceIds('boo1');
    assert.deepStrictEqual(idsInBoo1, idsInFoo1);
  });  

  it('should add references to the new group', async () => {
    let idsInBoo1 = await bookends.getGroupReferenceIds('boo1');
    let idsInFoo2 = await bookends.getGroupReferenceIds('foo2');
    let msg = await bookends.addToStaticGroup("boo1", idsInFoo2 );
    assert.equal( (await bookends.getGroupReferenceIds('boo1')).length, idsInBoo1.length + idsInFoo2.length);
  });    
});