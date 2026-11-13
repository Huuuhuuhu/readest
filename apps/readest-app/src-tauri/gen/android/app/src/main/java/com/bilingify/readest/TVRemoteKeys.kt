package com.bilingify.readest

import android.view.KeyEvent

// One native route for each remote key; WebView must not also synthesize it.
internal fun tvRemoteKeyName(keyCode: Int): String? = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
    KeyEvent.KEYCODE_MENU -> "ContextMenu"
    KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> "Escape"
    else -> null
}
