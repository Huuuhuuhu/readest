package com.bilingify.readest

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TVRemoteKeysTest {
    @Test fun mapsRemoteControlsWithoutTakingSystemKeys() {
        assertEquals("Enter", tvRemoteKeyName(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals("ContextMenu", tvRemoteKeyName(KeyEvent.KEYCODE_MENU))
        assertEquals("Escape", tvRemoteKeyName(KeyEvent.KEYCODE_BACK))
        assertEquals("ArrowLeft", tvRemoteKeyName(KeyEvent.KEYCODE_DPAD_LEFT))
        listOf(KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_POWER, KeyEvent.KEYCODE_VOICE_ASSIST)
            .forEach { assertNull(tvRemoteKeyName(it)) }
    }
}
