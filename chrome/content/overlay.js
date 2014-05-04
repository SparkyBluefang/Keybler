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

if(!caligon) var caligon = {};
if(!caligon.keybler) caligon.keybler = {};

window.addEventListener("load", function buildKeybler()
{
	window.removeEventListener("load", buildKeybler, false);

	let CC = Components.classes;
	let CI = Components.interfaces;
	let CU = Components.utils;

	let kse_service = CC["@caligonstudios.com/keybler;1"].getService(CI.nsIKeybler);

//
// Element getters
//
	let kse_getters =
	{
		getterMap:
		[
			["context",         "contentAreaContextMenu"],
			["menu",            "context-keybler-menu"],
			["strings",         "bundle_keybler"]
		],

		resetGetters: function()
		{
			this.getterMap.forEach(function(getter)
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
			this.getterMap.forEach(function(getter)
			{
				let [prop, id] = getter;
				delete this[prop];
			}, this);

			delete this.urlbar;
		}
	}

//
// Primary entry points
//
	let kse_last_value = "";

	let kse_onCommand = function(aEvent)
	{
		if(aEvent.type == "click" && aEvent.button != 1)
		{
			return;
		}

		let eventTarget = aEvent.target;
		let localName = eventTarget.localName.toLowerCase();

		if(localName == "menuitem")
		{
			let openIn = whereToOpenLink(aEvent, false, true);
			let inBackground = null;

			if(openIn == "current")
			{
				openIn = kse_service.openIn;
				inBackground = kse_service.openInBackground;
			}

			let keywords = eventTarget.getAttribute("keyword").split("|");
			kse_openKeywords(window, openIn, inBackground, keywords, kse_last_value);
		}
		else
		{
			aEvent.preventDefault();
		}
	}
	caligon.keybler.onCommand = kse_onCommand;

	let kse_openKeywords = function(aWindow, aTarget, aBackground, aKeywords, aText)
	{
		Services.console.logStringMessage("Opening keyword searches [" + aKeywords + "] on '" + aText + "'");

		return Task.spawn(function()
		{
			let keywordWindow = yield kse_openKeyword(aWindow, aTarget, aBackground, aKeywords.shift(), aText);

			if(aKeywords.length > 0)
			{
				let keywordLoader = function()
				{
					keywordWindow.addEventListener("load", keywordLoader, false);

					while(aKeywords.length > 0)
					{
						kse_openKeyword(keywordWindow, "tab", true, aKeywords.shift(), aText);
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
		});
	}

	let kse_openKeyword = function(aWindow, aTarget, aBackground, aKeyword, aText)
	{
		Services.console.logStringMessage("Opening keyword search [" + aKeyword + "] on '" + aText + "'");

		return Task.spawn(function()
		{
			let data = yield getShortcutOrURIAndPostData(aKeyword + " " + aText);

			if(aTarget == "window")
			{
				let win = aWindow.openDialog(getBrowserURL(), "_blank", "chrome,all,dialog=no", url, null, null, postData);
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
		});
	}

	let kse_onContextShowing = function(aEvent)
	{
		let menu = kse_getters.menu;

		kse_last_value = kse_getText();
		if(kse_last_value)
		{
			menu.hidden = false;
			let label = kse_truncate(kse_last_value);
			menu.setAttribute("label", kse_getters.strings.getFormattedString("searchFor", [label]));
		}
		else
		{
			menu.hidden = true;
		}
	}

	let kse_getText = function()
	{
		return getBrowserSelection();
	}

	let kse_truncate = function(text)
	{
		let maxLength = kse_service.maxMenuItemLength;
		if(text.length > maxLength)
		{
			text = text.substring(0, maxLength - 1) + "\u2026";
		}

		return text;
	}

	let kse_buildPopup = function(root)
	{
		let rootMenu = kse_getters.menu;

		while(rootMenu.hasChildNodes())
		{
			rootMenu.removeChild(rootMenu.firstChild);
		}

		kse_buildNode(root, rootMenu);
	}
	caligon.keybler.buildPopup = kse_buildPopup;

	let kse_buildNode = function(node, menu)
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
				let childKeywords = kse_buildNode(children[i], subMenu);
				keywords = keywords.concat(childKeywords);
			}

			subMenu.appendChild(document.createElement("menuseparator"));

			let allItem = document.createElement("menuitem");
			allItem.setAttribute("label", kse_getters.strings.getString("searchAllFor"));
			allItem.setAttribute("keyword", keywords.join("|"));

			subMenu.appendChild(allItem);
		}

		item.setAttribute("label", node.label);

		menu.appendChild(item);

		return keywords;
	}

//
// Setup and register KM components on window creation
//
	let kse_setupWindow = function()
	{
		kse_getters.resetGetters();

		kse_service.updateWindow(window);

		kse_getters.context.addEventListener("popupshowing", kse_onContextShowing, false);

		window.addEventListener("unload", kse_destroyWindow, false);
	}
	caligon.keybler.setupWindow = kse_setupWindow;

//
// Destroy and unregister KM components on window destruction
//
	let kse_destroyWindow = function()
	{
		window.removeEventListener("unload", kse_destroyWindow, false);

		kse_getters.context.removeEventListener("popupshowing", kse_onContextShowing, false);

		kse_getters.destroy();
	}
	caligon.keybler.destroyWindow = kse_destroyWindow;

	kse_setupWindow();
}, false);

