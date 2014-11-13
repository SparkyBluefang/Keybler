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

const EXPORTED_SYMBOLS = ["Keybler"];

const CC = Components.classes;
const CI = Components.interfaces;
const CU = Components.utils;

const kse_service = CC["@caligonstudios.com/keybler;1"].getService(CI.nsIKeybler);

CU.import("resource://gre/modules/Services.jsm");
CU.import("resource://gre/modules/Task.jsm");

function Keybler(window)
{
	this._window = window;

	this.getters = new KeyblerWindowGetters(this._window);
}

Keybler.prototype =
{
	_window:  null,

	getters:   null,
	lastValue: null,

	__bound_onContextShowing: null,

	setup: function()
	{
		this._window.addEventListener("unload", this, false);

		this.getters.resetGetters();

		kse_service.updateWindow(this._window);

		this.__bound_onContextShowing = this.onContextShowing.bind(this);

		this.getters.context.addEventListener("popupshowing", this.__bound_onContextShowing, false);
	},

	destroy: function()
	{
		this._window.removeEventListener("unload", this, false);

		this.getters.context.removeEventListener("popupshowing", this.__bound_onContextShowing, false);

		this.getters.destroy();

		["_window", "getters", "__bound_onContextShowing"].forEach(function(prop)
		{
			delete this[prop];
		}, this);
	},

	handleEvent: function(aEvent)
	{
		switch(aEvent.type)
		{
			case "unload":
				this.destroy();
				break;
		}
	},

	onCommand: function(aEvent)
	{
		if(aEvent.type == "click" && aEvent.button != 1)
		{
			return;
		}

		let eventTarget = aEvent.target;
		let localName = eventTarget.localName.toLowerCase();

		if(localName == "menuitem")
		{
			let openIn = this._window.whereToOpenLink(aEvent, false, true);
			let inBackground = null;

			if(openIn == "current")
			{
				openIn = kse_service.openIn;
				inBackground = kse_service.openInBackground;
			}

			let keywords = eventTarget.getAttribute("keyword").split("|");
			this.openKeywords(this._window, openIn, inBackground, keywords, this.lastValue);
		}
		else
		{
			aEvent.preventDefault();
		}
	},

	openKeywords: function(aWindow, aTarget, aBackground, aKeywords, aText)
	{
		Services.console.logStringMessage("Opening keyword searches [" + aKeywords + "] on '" + aText + "'");

		return Task.spawn(function()
		{
			let keywordWindow = yield this.openKeyword(aWindow, aTarget, aBackground, aKeywords.shift(), aText);

			if(aKeywords.length > 0)
			{
				let keywordLoader = function()
				{
					keywordWindow.addEventListener("load", keywordLoader, false);

					while(aKeywords.length > 0)
					{
						this.openKeyword(keywordWindow, "tab", true, aKeywords.shift(), aText);
					}
				}

				if(keywordWindow == window)
				{
					keywordLoader();
				}
				else
				{
					keywordWindow.addEventListener("load", keywordLoader, false);
				}
			}
		}.bind(this));
	},

	openKeyword: function(aWindow, aTarget, aBackground, aKeyword, aText)
	{
		Services.console.logStringMessage("Opening keyword search [" + aKeyword + "] on '" + aText + "'");

		return Task.spawn(function()
		{
			let data = yield (Services.vc.compare("31.*", Services.appinfo.version) < 0)
				? new Promise(resolve => this._window.getShortcutOrURIAndPostData(aKeyword + " " + aText, resolve))
				: this._window.getShortcutOrURIAndPostData(aKeyword + " " + aText);

			if(aTarget == "window")
			{
				let win = aWindow.openDialog(getBrowserURL(), "_blank", "chrome,all,dialog=no", url, null, null, data.postData);
				throw new Task.Result(win);
			}
			else
			{
				let params = {
					postData: data.postData,
					inBackground: aBackground,
				};
				aWindow.openLinkIn(data.url, aTarget, params);
				throw new Task.Result(aWindow);
			}
		}.bind(this));
	},

	onContextShowing: function(aEvent)
	{
		let menu = this.getters.menu;

		this.lastValue = this.getText();
		if(this.lastValue)
		{
			menu.hidden = false;
			let label = this.truncate(this.lastValue);
			menu.setAttribute("label", this.getters.strings.getFormattedString("searchFor", [label]));
		}
		else
		{
			menu.hidden = true;
		}
	},

	getText: function()
	{
		return this._window.getBrowserSelection();
	},

	truncate: function(text)
	{
		let maxLength = kse_service.maxMenuItemLength;
		if(text.length > maxLength)
		{
			text = text.substring(0, maxLength - 1) + "\u2026";
		}

		return text;
	},

	buildPopup: function(root)
	{
		let rootMenu = this.getters.menu;

		while(rootMenu.hasChildNodes())
		{
			rootMenu.removeChild(rootMenu.firstChild);
		}

		this.buildNode(this._window.document, root, rootMenu);
	},

	buildNode: function(document, node, menu)
	{
		let item = null;
		let keywords = [];

		if(node.type == "keyword")
		{
			item = document.createElement("menuitem");
			item.setAttribute("class", "menuitem-iconic bookmark-item");
			item.setAttribute("keyword", node.keyword);
			item.setAttribute("image", node.icon);
			keywords.push(node.keyword);
		}
		else
		{
			let subMenu = document.createElement("menupopup");
			item = subMenu;
			if(node.type != "root")
			{
				item = document.createElement("menu");
				item.setAttribute("class", "menu-iconic bookmark-item");
				item.setAttribute("container", "true");
				item.appendChild(subMenu);
			}

			let children = node.children;
			for(let i = 0; i < children.length; i++)
			{
				let childKeywords = this.buildNode(document, children[i], subMenu);
				keywords = keywords.concat(childKeywords);
			}

			subMenu.appendChild(document.createElement("menuseparator"));

			let allItem = document.createElement("menuitem");
			allItem.setAttribute("label", this.getters.strings.getString("searchAllFor"));
			allItem.setAttribute("keyword", keywords.join("|"));

			subMenu.appendChild(allItem);
		}

		item.setAttribute("label", node.label);

		menu.appendChild(item);

		return keywords;
	}
};

function KeyblerWindowGetters(window)
{
	this._window = window;
}

KeyblerWindowGetters.prototype =
{
	_window:    null,

	_getterMap:
		[
			["context",         "contentAreaContextMenu"],
			["menu",            "context-keybler-menu"],
			["strings",         "bundle_keybler"]
		],

	resetGetters: function()
	{
		let document = this._window.document;

		this._getterMap.forEach(function(getter)
		{
			let [prop, id] = getter;
			delete this[prop];
			this.__defineGetter__(prop, function()
			{
				delete this[prop];
				return this[prop] = document.getElementById(id);
			});
		}, this);
	},

	destroy: function()
	{
		this._getterMap.forEach(function(getter)
		{
			let [prop, id] = getter;
			delete this[prop];
		}, this);

		["_window"].forEach(function(prop)
		{
			delete this[prop];
		}, this);
	}
};

