/* global describe, it, beforeEach, afterEach */

const bookends = require('../index');
const fixture = require('./fixture');
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
    let refIds = await bookends.findIdsWhere("title REGEX 'Bibliographic'");
    assert( util.isArray(refIds), "Method did not return an Array");
    assert.equal( refIds.length, 6, "Incorrect number of found references." );
  });

  it('should return formatted references', async () => {
    let result = await bookends.formatReferences([41103,57913], "APA 6th Edition",false);
    assert( Array.isArray(result), "Method did not return an Array");
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

  it('should retrieve reference data', async () => {
    let idsInBoo1 = await bookends.getGroupReferenceIds('foo2');
    let fields = "type,authors,title,thedate,location,publisher".split(/,/);
    let data = await bookends.readReferences(idsInBoo1, fields);
    let expected = [
      { authors: 'Bade, David W.',
        location: "Duluth, Minn.",
        publisher: 'Library Juice Press',
        thedate: '2007',
        title: 'Responsible librarianship : library policies for unreliable systems',
        type: "Book",
        uniqueID: 17235 },
      { authors: 'Chaplin, A. H.',
        location: "London",
        publisher: 'Library Association',
        thedate: '1973',
        title: 'The British Library and AACR: report of a study commissioned by the Department of Education and Science; director of study A. H. Chaplin.',
        type: "Book",
        uniqueID: 86287 }
    ];
    assert.deepStrictEqual(data,expected);
  });

  it('should update reference data', async () => {
    let idsInBoo1 = await bookends.getGroupReferenceIds('foo2');
    let fields = "type,authors,title,thedate,location,publisher".split(/,/);
    let data = await bookends.readReferences(idsInBoo1, fields);
    data[0].authors = 'Doe, John';
    data[0].type = 'Edited book';
    data[0].thedate = 2008;
    data[1].title = 'The quick brown fox jumps over the lazy dog. ÄÖÜßáà';
    await bookends.updateReferences(data);
    data = await bookends.readReferences(idsInBoo1, fields);
    // for some reason, the references are returned in reverse order
    let expected = [
      { authors: 'Chaplin, A. H.',
        location: "London",
        publisher: 'Library Association',
        thedate: '1973',
        title: 'The quick brown fox jumps over the lazy dog. ÄÖÜßáà',
        type: "Book",
        uniqueID: 86287 },
      { authors: "Doe, John",
        location: "Duluth, Minn.",
        publisher: 'Library Juice Press',
        thedate: '2008',
        title: 'Responsible librarianship : library policies for unreliable systems',
        type: "Edited book",
        uniqueID: 17235 }
    ];
    assert.deepStrictEqual(data,expected);
  });

  it('should create references', async () => {
    let refs = [
      { authors: 'Doe, Jane',
        thedate: '2008',
        title: 'Compiling a bibliography is so much fun!',
        type: "Journal article",
        journal: "Journal of Spurious Results",
        volume: "60(2)",
        pages: "100-120",
        keywords: "bibliography; scholarship; example"
      },
      { location: "New York",
        authors: "Nymous, Ano; Doe, John; Doe, Jane",
        volume: 'Responsible librarianship : library policies for unreliable systems',
        pages: "1-25",
        publisher: 'Library Juice Press',
        thedate: '2008',
        title: "Introduction",
        type: "Book chapter",
      }
    ];
    await bookends.addReferences(refs);
  });

  it('should retrieve modification dates', async () => {
    let allIds = await bookends.getGroupReferenceIds('All');
    let modDates = await bookends.modificationDates(allIds);
    assert.equal(modDates.length, allIds.length);
    modDates.forEach(date => {
      if ( ! date instanceof Date ) throw new Error("Invalid date in result");
    });
  });
});
