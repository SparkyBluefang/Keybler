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

if(!caligon) var caligon = {};

window.addEventListener("load", function buildKeybler()
{
	window.removeEventListener("load", buildKeybler, false);

	Components.utils.import("resource://keybler/Keybler.jsm");

	caligon.keybler = new Keybler(window);
	caligon.keybler.setup();
}, false);

