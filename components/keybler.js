/*
 * ***** BEGIN LICENSE BLOCK *****
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * 
 * Copyright (C) 2014 Matthew Turnbull <sparky@bluefang-logic.com>. All Rights Reserved.
 * 
 * ***** END LICENSE BLOCK *****
*/

"use strict";

// Component constants
const CC = Components.classes;
const CI = Components.interfaces;
const CU = Components.utils;

CU.import("resource://gre/modules/XPCOMUtils.jsm");
CU.import("resource://gre/modules/Services.jsm");
CU.import("resource://gre/modules/Task.jsm");

const bookmark_service = CC["@mozilla.org/browser/nav-bookmarks-service;1"].getService(CI.nsINavBookmarksService);
const history_service = CC["@mozilla.org/browser/nav-history-service;1"].getService(CI.nsINavHistoryService);

const bookmark_folders = [
	bookmark_service.toolbarFolder,
	bookmark_service.bookmarksMenuFolder,
	bookmark_service.unfiledBookmarksFolder
];

const TRACKED_PROPS = ["favicon", "uri", "title"];

function Keybler(){}

Keybler.prototype =
{
	classID:		Components.ID("{a7b6ce09-16eb-4251-b72c-47b0659bd4fd}"),
	QueryInterface:		XPCOMUtils.generateQI([
					CI.nsISupportsWeakReference,
					CI.nsIObserver,
					CI.nsINavBookmarkObserver,
					CI.nsIKeybler
				]),

	nodesById:		{},
	root:			[],

	prefs:			null,

	collapseEmptyFolders:	true,
	maxMenuItemLength:	20,
	openIn:			"tab",
	openInBackground:	true,
	sortByFolder:		true,
	sortByName:		true,

	pref_registry:
	{
		"collapseEmptyFolders":
		{
			update: function()
			{
				this.collapseEmptyFolders = this.prefs.getBoolPref("collapseEmptyFolders");
				this.rebuild(true);
			}
		},

		"maxMenuItemLength":
		{
			update: function()
			{
				this.maxMenuItemLength = this.prefs.getIntPref("maxMenuItemLength");
			}
		},

		"openIn":
		{
			update: function()
			{
				let tmpVal = this.prefs.getCharPref("openIn");
				this.openInBackground = (tmpVal == "background-tab");

				switch(tmpVal)
				{
					case "background-tab":
						tmpVal = "tab";
					case "current":
					case "tab":
						this.openIn = tmpVal;
						break;
					default:
						this.openIn = "window";
						break;
				}
			}
		},

		"sortByFolder":
		{
			update: function()
			{
				this.sortByFolder = this.prefs.getBoolPref("sortByFolder");
				this.rebuild(true);
			}
		},

		"sortByName":
		{
			update: function()
			{
				this.sortByName = this.prefs.getBoolPref("sortByName");
				this.rebuild(true);
			}
		}
	},

	// nsIObserver

	observe: function(subject, topic, data)
	{
		try
		{
			switch(topic)
			{
				case "profile-after-change":
					this.startup();
					break;
				case "quit-application":
					this.shutdown();
					break;
				case "nsPref:changed":
					this.updatePref(data);
					break;
			}
		}
		catch(e)
		{
			CU.reportError(e);
		}
	},

	// nsINavBookmarkObserver

	onItemAdded: function(itemId, folder, index,  itemType, uri, title, dateAdded, guid, parentGuid)
	{
		if(itemType == CI.nsINavBookmarksService.TYPE_BOOKMARK
		&& bookmark_service.getKeywordForBookmark(itemId))
		{
			this.rebuild(true);
		}
	},

	onItemRemoved: function(itemId, parentId, index, type, uri, guid, parentGuid)
	{
		if(itemId in this.nodesById)
		{
			this.rebuild(true);
		}
	},

	onItemChanged: function(itemId, property, isAnno, value, lastModified, itemType, parentId, guid, parentGuid)
	{
		if(property == "keyword"
		|| (itemId in this.nodesById && TRACKED_PROPS.indexOf(property) > -1))
		{
			this.rebuild(true);
		}
	},

	onItemMoved: function(itemId, oldParentId, oldIndex, newParentId, newIndex, itemType, guid, oldParentGuid, newParentGuid)
	{
		if(itemId in this.nodesById)
		{
			this.rebuild(true);
		}
	},

	onBeginUpdateBatch: function() {},
	onEndUpdateBatch: function() {},
	onItemVisited: function() {},

	// nsIKeybler

	startup: function()
	{
		this.prefs = Services.prefs.getBranch("caligon.keybler.").QueryInterface(CI.nsIPrefBranch2);

		for(let pref in this.pref_registry)
		{
			let pro = this.pref_registry[pref];

			pro.update = pro.update.bind(this);

			this.prefs.addObserver(pref, this, true);

			this.updatePref(pref);
		}

		Services.obs.addObserver(this, "quit-application", true);
		bookmark_service.addObserver(this, true);

		this.rebuild(false);
	},

	shutdown: function()
	{
		bookmark_service.removeObserver(this);
		Services.obs.removeObserver(this, "quit-application");

		for(let pref in this.pref_registry)
		{
			this.prefs.removeObserver(pref, this);
		}

		this.prefs = null;
	},

	updatePref: function(pref)
	{
		if(!(pref in this.pref_registry))
		{
			return;
		}
		let pro = this.pref_registry[pref];

		pro.update();
	},

	rebuild: function(updateWindows)
	{
		Task.spawn((function() {
			this._rebuild();

			if(updateWindows)
			{
				this.updateWindows();
			}
		}).bind(this));
	},

	_rebuild: function()
	{
		Services.console.logStringMessage("Starting keywords reload");

		let options = history_service.getNewQueryOptions();
		options.queryType = options.QUERY_TYPE_BOOKMARKS;

		let query = history_service.getNewQuery();
		query.setFolders(bookmark_folders, bookmark_folders.length);

		let result = history_service.executeQuery(query, options);
		let resultContainerNode = result.root;

		let _nodes = [];
		let _nodesById = {};

		resultContainerNode.containerOpen = true;
		for(let i = 0; i < resultContainerNode.childCount; ++i)
		{
			let childNode = resultContainerNode.getChild(i);
			let keyword = bookmark_service.getKeywordForBookmark(childNode.itemId);
			if(keyword)
			{
				this._addNode(childNode, keyword, _nodes, _nodesById);
			}
		}
		resultContainerNode.containerOpen = false;

		let _root = {
			type: "root",
			children: _nodes
		}

		if(this.sortByFolder && this.collapseEmptyFolders)
		{
			this._collapseNode(_root)
		}

		this._sortNode(_root);

		this.root = _root;
		this.nodesById = _nodesById;
	},

	_addNode: function(node, keyword, _nodes, _nodesById)
	{
		if(this.sortByFolder)
		{
			let parentId = bookmark_service.getFolderIdForItem(node.itemId);
			if(bookmark_folders.indexOf(parentId) == -1) {
				_nodes = this._addParent(parentId, _nodes, _nodesById).children;
			}
		}

		let n = {
			id: node.itemId,
			label: node.title,
			type: "keyword",
			index: node.index,
			keyword: keyword,
			icon: node.icon
		};

		Services.console.logStringMessage("Adding node " + n.id + " " + n.label + " " + n.keyword);

		_nodes.push(n);
		_nodesById[n.id] = n;
	},

	_addParent: function(itemId, _nodes, _nodesById)
	{
		let p = _nodesById[itemId];
		if(p)
		{
			return p;
		}

		let parentId = bookmark_service.getFolderIdForItem(itemId);
		if(bookmark_folders.indexOf(parentId) == -1) {
			_nodes = this._addParent(parentId, _nodes, _nodesById).children;
		}

		let title = bookmark_service.getItemTitle(itemId)
		let index = bookmark_service.getItemIndex(itemId)

		p = {
			id: itemId,
			label: title,
			type: "folder",
			index: index,
			children: []
		};

		Services.console.logStringMessage("Adding parent " + p.id + " " + p.label);

		_nodes.push(p);
		_nodesById[p.id] = p;

		return p;
	},

	_collapseNode: function(node)
	{
		if(node.type == "folder" || node.type == "root")
		{
			if(node.children.length == 1)
			{
				let child = node.children[0];
				if(child.type == "folder")
				{
					node.children = child.children;
				}
			}

			node.children.forEach(this._collapseNode, this);
		}
	},

	_sortNode: function(node)
	{
		if(node.type == "folder" || node.type == "root")
		{
			node.children.sort(this.sortByName ? this._sortByLabel : this._sortByIndex);
			node.children.forEach(this._sortNode, this);
		}
	},

	_sortByLabel: function(a, b)
	{
		let al = a.label;
		let bl = b.label;

		return (al < bl) ? -1 : (al > bl) ? 1 : 0;
	},

	_sortByIndex: function(a, b)
	{
		let al = a.index;
		let bl = b.index;

		return (al < bl) ? -1 : (al > bl) ? 1 : 0;
	},

	updateWindows: function()
	{
		let windowsEnum = Services.wm.getEnumerator("navigator:browser");
		while(windowsEnum.hasMoreElements())
		{
			this.updateWindow(windowsEnum.getNext());
		}
	},

	updateWindow: function(win)
	{
		if(!(win instanceof CI.nsIDOMWindow)
		|| !(win.document.documentElement.getAttribute("windowtype") == "navigator:browser"))
		{
			return;
		}

		win.caligon.keybler.buildPopup(this.root);
	},

	resetPrefs: function()
	{
		let childPrefs = this.prefs.getChildList("");
		childPrefs.forEach(function(pref)
		{
			if(this.prefs.prefHasUserValue(pref))
			{
				this.prefs.clearUserPref(pref);
			}
		}, this);
	},

	dumpJSON: function(win)
	{
		if(!win)
		{
			win = Services.wm.getMostRecentWindow("navigator:browser");
		}

		let json = JSON.stringify(this.root);
		win.open("data:application/json," + encodeURIComponent(json), "");
	}
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([Keybler]);

