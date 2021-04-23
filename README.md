# bookends-api

A NodeJS API client for the Bookenends Reference Manager (http://www.sonnysoftware.com).

Requires Bookends version >= 13.1.1

Status: deprecated

> Since version 13.3, Bookends supports scripting via an AppleScript dictionary, which is a 
> much more robust and better documented way of scripting the application, and also allows
> to use Javascript as a scripting language via the OSA-JavascriptCore Bridge (although this
> is very much underdocumented). See https://github.com/cboulanger/zotero-sync-bookends for
> an updated approach to Bookends scripting with NodeJS. Scripting via Apple Events, the approach
> taken in this library, is still supported by Bookends, but deprecated. 

## Setup
```bash
git clone https://github.com/cboulanger/bookends-api.git
cd bookends-api
npm install
```

## Examples
The library contains [example scripts](/examples), including a [Bookends-Zotero synchronization command](/examples/bookends-zotero-sync).

```
$ examples/bookends-zotero-sync
bookends-zotero-sync <path> [options]

Synchronizes a Bookends database with a Zotero library.

Positionals:
  path  the path to the zotero library, either groups/<group id> or users/<user id>
                                                                        [string]

Optionen:
  --target   If given, do only one-way sync to target                   [string]
  --key      The zotero API key, if not provided as the environment variable
             ZOTERO_API_KEY.                                            [string]

```

WARNING: This is alpha-grade software solely for testing and proof-of-concept
purposes. DO *NOT* use Bookends libraries that you depend on. You have been
warned.

To use it, open a new (!) Bookends library, add one (empty) item (this is
required to avoid a runtime error), and execute the command as follows:

```
$ examples/bookends-zotero-sync groups/<the numeric id of the group> --target=bookends --key=<Your Zotero API key>
```

This does a one-way sync between the Zotero group library to the currently
opened Bookends library. If the script works as intended, you should be able to
update this library with new additions and changes from the Zotero library. The
script can also do Bookends-to-Zotero and two-way sync, but the synchronization
algorithm is not perfect yet, which is due to the fact that it is difficult to
store synchronization metadata in Bookends itself.

## Testing

`npm test`

## Resources
- [API Documentation](https://cboulanger.github.io/bookends-api/module-bookends-api.html) 
