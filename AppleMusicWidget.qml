import QtQuick
import QtQuick.Effects
import Quickshell
import qs.Commons
import qs.Ui
import "AppleMusicModel.js" as Model

BarWidget {
  id: root
  moduleName: "iuliansafta.apple-music"

  readonly property var music: bar && bar.shell
    ? bar.shell.serviceFor("iuliansafta.apple-music") : null
  readonly property string barDisplay: String(setting("barDisplay", "Artwork"))
  readonly property bool artworkDisplay: barDisplay !== "Text"
  readonly property bool showArtist: setting("showArtist", true)
  readonly property real maxLabelWidth: setting("maxLabelWidth", 220)
  readonly property bool showQueue: setting("showQueue", true)
  readonly property bool showRecentlyPlayed: setting("showRecentlyPlayed", true)
  readonly property bool showPlaybackModes: setting("showPlaybackModes", true)
  // Nerd Font nf-md glyphs, resolved from CaskaydiaMono Nerd Font's cmap:
  // md-heart, md-heart_outline, md-thumb_down, md-thumb_down_outline
  readonly property string heartIcon: String.fromCodePoint(0xf02d1)
  readonly property string heartOutlineIcon: String.fromCodePoint(0xf02d5)
  readonly property string thumbDownIcon: String.fromCodePoint(0xf0511)
  readonly property string thumbDownOutlineIcon: String.fromCodePoint(0xf0512)
  // nf-md-shuffle, nf-md-repeat, nf-md-repeat_once, nf-md-repeat_off,
  // nf-md-autoplay — all verified present in CaskaydiaMono Nerd Font's cmap.
  readonly property string shuffleIcon: String.fromCodePoint(0xf1022)
  readonly property string repeatIcon: String.fromCodePoint(0xf0459)
  readonly property string repeatOnceIcon: String.fromCodePoint(0xf045a)
  readonly property string repeatOffIcon: String.fromCodePoint(0xf045b)
  readonly property string plusIcon: String.fromCodePoint(0xf0415)
  readonly property string checkIcon: String.fromCodePoint(0xf012c)
  readonly property string clockOutlineIcon: String.fromCodePoint(0xf0465)
  readonly property string alertIcon: String.fromCodePoint(0xf0292)
  readonly property string autoplayIcon: String.fromCodePoint(0xf0ab5)
  readonly property color popupForeground: bar ? bar.foreground : Color.foreground
  readonly property string popupFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string trackLabel: {
    if (!music || !music.hasMedia) return "Music"
    if (showArtist && music.artist) return music.artist + " — " + music.title
    return music.title || music.artist
  }
  readonly property string tooltipLabel: {
    if (!music || !music.hasMedia) return "Apple Music"
    if (music.title && music.artist) return music.title + " — " + music.artist
    return music.title || music.artist || "Apple Music"
  }
  readonly property string playbackIcon: music && music.playing ? "󰏤" : "󰐊"

  property bool popupOpen: false
  readonly property bool opened: popupOpen
  readonly property bool tooltipHovered: visible && opacity > 0 && barMouseArea.containsMouse

  function open() { popupOpen = true }
  function close() { popupOpen = false }
  function toggle() { popupOpen = !popupOpen }

  // Last artwork URL that decoded successfully. Chromium hands MPRIS a new
  // /tmp artwork file several times per track switch and deletes the old
  // ones, so binding an Image straight to artUrl flashes placeholders. The
  // visible images keep painting readyArtUrl until the new URL finishes
  // loading in the probe below.
  property string readyArtUrl: ""

  // Omarchy's draggable bar wrapper uses this contract both to dispatch
  // clicks and to decide whether the slot should show a pointing cursor.
  function triggerPress(button) {
    if (!music) return
    if (button === Qt.MiddleButton && music.available) music.togglePlayback()
    else if (!music.available) music.openAppleMusic()
    else toggle()
  }

  implicitWidth: vertical
    ? barSize
    : (artworkDisplay ? Style.bar.iconSlot : textRow.implicitWidth + Style.space(14))
  implicitHeight: vertical && artworkDisplay ? Style.bar.iconSlot : barSize

  Item {
    id: artworkPuck
    anchors.centerIn: parent
    width: root.vertical ? root.barSize : Style.bar.iconSlot
    height: root.vertical ? Style.bar.iconSlot : root.barSize
    visible: root.artworkDisplay

    readonly property real canvasSize: Math.max(
      Style.bar.iconCanvas,
      Math.min(Style.space(20), Math.min(width, height) - Style.space(6)))

    Rectangle {
      id: artworkMask
      width: artworkPuck.canvasSize
      height: width
      radius: Style.space(4)
      visible: false
      layer.enabled: true
      color: "white"
    }

    // Render the SVG once at physical resolution and colorize it outside the
    // album-art mask. Keeping this to one effect avoids the softened edges
    // caused by routing the logo through both colorization and artwork masks.
    Image {
      id: themedLogoSource
      anchors.centerIn: parent
      width: Style.bar.iconFont
      height: width
      source: Qt.resolvedUrl("assets/apple-music-monochrome.svg")
      sourceSize.width: Math.round(width * Screen.devicePixelRatio)
      sourceSize.height: Math.round(height * Screen.devicePixelRatio)
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      smooth: true
      visible: false
      layer.enabled: true
    }

    MultiEffect {
      anchors.fill: themedLogoSource
      source: themedLogoSource
      visible: puckArtwork.status !== Image.Ready
      colorization: 1.0
      colorizationColor: root.popupForeground
    }

    Item {
      id: artworkSurface
      anchors.centerIn: parent
      width: artworkPuck.canvasSize
      height: width
      visible: puckArtwork.status === Image.Ready
      layer.enabled: true
      layer.smooth: true
      layer.effect: MultiEffect {
        maskEnabled: true
        maskSource: artworkMask
        maskThresholdMin: 0.3
        maskSpreadAtMin: 0.1
      }

      Image {
        id: puckArtwork
        anchors.fill: parent
        source: root.readyArtUrl
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: false
        smooth: true
        visible: status === Image.Ready
      }

      Rectangle {
        anchors.fill: parent
        visible: !!root.music && root.music.hasMedia && !root.music.playing
        color: Util.alpha("#000000", 0.32)
      }

      OpticalGlyph {
        anchors.centerIn: parent
        width: Style.space(10)
        height: width
        visible: !!root.music && root.music.hasMedia && !root.music.playing
        text: "󰐊"
        color: "white"
        fontFamily: root.bar ? root.popupFontFamily : Style.font.family
        fontSize: Style.font.caption
      }

      Rectangle {
        id: puckProgressTrack
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Math.max(1, Style.space(2))
        visible: !!root.music && root.music.hasMedia && root.music.hasValidLength
        color: Util.alpha("#000000", 0.38)

        Rectangle {
          width: parent.width * (root.music ? root.music.progress : 0)
          height: parent.height
          color: Color.accent
        }
      }
    }
  }

  Row {
    id: textRow
    anchors.centerIn: parent
    spacing: Style.space(6)
    visible: !root.artworkDisplay

    Item {
      width: Style.bar.iconCanvas
      height: Style.bar.iconCanvas
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -1.5

      OpticalGlyph {
        anchors.fill: parent
        text: ""
        color: root.bar ? root.bar.barForeground : Color.foreground
        fontFamily: root.bar ? root.popupFontFamily : Style.font.family
        fontSize: Style.bar.iconFont
      }
    }

    Item {
      width: Math.min(root.maxLabelWidth, label.implicitWidth)
      height: label.implicitHeight
      clip: true
      anchors.verticalCenter: parent.verticalCenter
      visible: !root.vertical

      Text {
        id: label
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: -0.5
        text: root.trackLabel
        color: root.bar ? root.bar.barForeground : Color.foreground
        font.family: root.bar ? root.popupFontFamily : Style.font.family
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
        width: Math.min(root.maxLabelWidth, implicitWidth)
      }
    }
  }

  MouseArea {
    id: barMouseArea
    anchors.fill: parent
    hoverEnabled: true
    Accessible.role: Accessible.Button
    Accessible.name: !root.music || !root.music.hasMedia
      ? "Open Apple Music"
      : "Apple Music: " + root.tooltipLabel + (root.music.playing ? ", playing" : ", paused")
    cursorShape: Qt.PointingHandCursor
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton

    onClicked: function(mouse) { root.triggerPress(mouse.button) }
    onWheel: function(wheel) {
      if (!root.music || !root.music.available) return
      if (wheel.angleDelta.y > 0) root.music.previous()
      else if (wheel.angleDelta.y < 0) root.music.next()
    }
    onEntered: if (root.bar) root.bar.showTooltip(root, root.tooltipLabel)
    onExited: if (root.bar) root.bar.hideTooltip(root)
  }

  Image {
    id: artworkProbe
    visible: false
    asynchronous: true
    cache: false
    source: root.music ? root.music.artUrl : ""
    onSourceChanged: if (String(source) === "") root.readyArtUrl = ""
    onStatusChanged: {
      if (status === Image.Null && String(source) === "") root.readyArtUrl = ""
      else if (status === Image.Ready) root.readyArtUrl = String(source)
    }
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    open: root.popupOpen
    contentWidth: popup.fittedContentWidth(Style.space(340))
    contentHeight: popup.fittedContentHeight(content.implicitHeight)

    // Blurred artwork glow behind the card contents, macOS now-playing
    // style. Sits as the first child of PopupCard's content holder so every
    // layout child paints on top of it.
    Rectangle {
      anchors.fill: parent
      anchors.margins: -popup.padding
      radius: Style.cornerRadius
      clip: true
      color: Color.popups.background
      visible: root.readyArtUrl !== ""

      Image {
        anchors.fill: parent
        anchors.margins: Style.space(24)
        source: root.readyArtUrl
        fillMode: Image.PreserveAspectCrop
        // Loads before the next paint, so the glow never shows a gap while
        // the freshly adopted artwork decodes.
        asynchronous: false
        layer.enabled: true
        layer.effect: MultiEffect {
          blurEnabled: true
          blur: 1.0
          blurMax: 48
          saturation: 0.5
        }
      }

      Rectangle {
        anchors.fill: parent
        color: Util.alpha(Color.popups.background, 0.5)
      }
    }

    Column {
      id: content
      anchors.fill: parent
      spacing: Style.space(12)

      Row {
        width: parent.width
        spacing: Style.space(12)

        BorderSurface {
          width: Style.space(88)
          height: width
          radius: Style.spacing.labelGap
          color: Style.normalFillFor(root.popupForeground, Color.accent)
          borderSpec: Border.controlSpec("normal", root.popupForeground, Color.accent)

          Image {
            id: artwork
            anchors.fill: parent
            anchors.margins: Style.space(2)
            source: root.readyArtUrl
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            cache: false
            visible: status === Image.Ready
          }

          Text {
            anchors.centerIn: parent
            visible: artwork.status !== Image.Ready
            text: "󰝚"
            color: root.popupForeground
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.displayLarge
          }
        }

        Column {
          width: parent.width - Style.space(100)
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(4)

          Text {
            width: parent.width
            text: root.music && root.music.title ? root.music.title : "Apple Music"
            color: root.popupForeground
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            text: root.music ? root.music.artist : ""
            visible: text !== ""
            color: Qt.darker(root.popupForeground, 1.3)
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            text: root.music ? root.music.album : ""
            visible: text !== ""
            color: Qt.darker(root.popupForeground, 1.6)
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }
      }

      Column {
        width: parent.width
        spacing: Style.space(4)
        visible: !!root.music && root.music.available

        Rectangle {
          id: progressTrack
          width: parent.width
          height: Style.space(5)
          radius: height / 2
          color: Util.alpha(root.popupForeground, 0.2)

          Rectangle {
            width: parent.width * (root.music ? root.music.progress : 0)
            height: parent.height
            radius: parent.radius
            color: Color.accent
          }

          MouseArea {
            anchors.fill: parent
            enabled: !!root.music && root.music.canSeek
            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: function(mouse) { root.music.seekFraction(mouse.x / width) }
          }
        }

        Row {
          width: parent.width

          Text {
            id: elapsed
            text: root.music ? root.music.elapsedText : "0:00"
            color: Qt.darker(root.popupForeground, 1.4)
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.caption
          }

          Item { width: parent.width - elapsed.implicitWidth - duration.implicitWidth; height: 1 }

          Text {
            id: duration
            text: root.music ? root.music.lengthText : "--:--"
            color: Qt.darker(root.popupForeground, 1.4)
            font.family: root.popupFontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Text {
          width: parent.width
          visible: !!root.music && !root.music.hasValidLength
          text: "Apple Music does not expose track duration"
          horizontalAlignment: Text.AlignHCenter
          color: Qt.darker(root.popupForeground, 1.6)
          font.family: root.popupFontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: Style.space(8)

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: "󰒮"
          foreground: root.popupForeground
          enabled: !!root.music && root.music.available && root.music.activePlayer.canGoPrevious
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.previous()
        }

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: root.playbackIcon
          foreground: root.popupForeground
          iconSize: Style.font.iconLarge
          enabled: !!root.music && root.music.available
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.togglePlayback()
        }

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: "󰒭"
          foreground: root.popupForeground
          enabled: !!root.music && root.music.available && root.music.activePlayer.canGoNext
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.next()
        }
      }

      // Compact secondary controls: ratings/library and playback modes share
      // one row, separated visually, so the popup keeps transport prominent
      // without spending three full rows on nine actions.
      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: Style.space(6)

        Button {
          width: Style.space(36)
          height: Style.space(34)
          iconText: root.music && root.music.rating === "like"
            ? root.heartIcon : root.heartOutlineIcon
          foreground: root.music && root.music.rating === "like"
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.bridgeActive
          opacity: enabled ? 1 : 0.4
          tooltipText: "Like"
          Accessible.name: "Like current song"
          onClicked: root.music.toggleLike()
        }

        Button {
          width: Style.space(36)
          height: Style.space(34)
          iconText: root.music && root.music.rating === "dislike"
            ? root.thumbDownIcon : root.thumbDownOutlineIcon
          foreground: root.music && root.music.rating === "dislike"
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.bridgeActive
          opacity: enabled ? 1 : 0.4
          tooltipText: "Suggest less"
          Accessible.name: "Suggest less like the current song"
          onClicked: root.music.toggleDislike()
        }

        Button {
          width: Style.space(36)
          height: Style.space(34)
          iconText: !root.music || root.music.libraryState === "unknown" ? root.plusIcon
            : root.music.libraryState === "absent" ? root.plusIcon
            : root.music.libraryState === "adding" ? root.clockOutlineIcon
            : root.music.libraryState === "present" ? root.checkIcon : root.alertIcon
          foreground: root.music && root.music.libraryState === "present"
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.libraryState === "absent"
          opacity: enabled ? 1 : 0.4
          tooltipText: !root.music || root.music.libraryState === "unknown"
            ? "Library state unavailable"
            : root.music.libraryState === "absent" ? "Add to library"
            : root.music.libraryState === "adding" ? "Adding to library"
            : root.music.libraryState === "present" ? "In your library"
            : "Couldn't add to library"
          Accessible.name: !root.music || root.music.libraryState === "unknown"
            ? "Library state unavailable"
            : root.music.libraryState === "absent" ? "Add current song to library"
            : root.music.libraryState === "adding" ? "Adding current song to library"
            : root.music.libraryState === "present" ? "Current song is in your library"
            : "Couldn't add to library"
          onClicked: root.music.addToLibrary()
        }

        Rectangle {
          width: 1
          height: Style.space(20)
          anchors.verticalCenter: parent.verticalCenter
          visible: root.showPlaybackModes && !!root.music && root.music.bridgeActive
          color: Util.alpha(root.popupForeground, 0.18)
        }

        Button {
          width: Style.space(36)
          height: Style.space(34)
          visible: root.showPlaybackModes && !!root.music && root.music.bridgeActive
          iconText: root.shuffleIcon
          foreground: root.music && root.music.shuffleMode === true
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.shuffleMode !== null
          opacity: enabled ? 1 : 0.4
          tooltipText: "Shuffle"
          Accessible.name: "Shuffle"
          onClicked: root.music.setShuffle(root.music.shuffleMode !== true)
        }

        Button {
          width: Style.space(36)
          height: Style.space(34)
          visible: root.showPlaybackModes && !!root.music && root.music.bridgeActive
          iconText: !root.music || root.music.repeatMode === "all" ? root.repeatIcon
            : root.music.repeatMode === "one" ? root.repeatOnceIcon : root.repeatOffIcon
          foreground: root.music && (root.music.repeatMode === "all" || root.music.repeatMode === "one")
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.repeatMode !== "unknown"
          opacity: enabled ? 1 : 0.4
          tooltipText: root.music && root.music.repeatMode === "one"
            ? "Repeat one" : root.music && root.music.repeatMode === "all" ? "Repeat all" : "Repeat off"
          Accessible.name: tooltipText
          onClicked: root.music.cycleRepeat()
        }

        Button {
          width: Style.space(36)
          height: Style.space(34)
          visible: root.showPlaybackModes && !!root.music && root.music.bridgeActive
          iconText: root.autoplayIcon
          foreground: root.music && root.music.autoplay === true
            ? Color.accent : root.popupForeground
          enabled: !!root.music && root.music.autoplay !== null
          opacity: enabled ? 1 : 0.4
          tooltipText: "Autoplay"
          Accessible.name: "Autoplay"
          onClicked: root.music.setAutoplay(root.music.autoplay !== true)
        }
      }

      Column {
        width: parent.width
        spacing: Style.space(4)
        visible: root.showQueue && !!root.music && root.music.upNext.length > 0

        PanelSeparator { foreground: root.popupForeground }

        Text {
          width: parent.width
          text: "Up next"
          color: Qt.darker(root.popupForeground, 1.4)
          font.family: root.popupFontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Repeater {
          model: root.showQueue && root.music ? root.music.upNext.slice(0, 6) : []

          Item {
            id: queueRow
            required property var modelData
            width: parent.width
            height: queueLabel.implicitHeight + Style.space(4)

            Text {
              id: queueLabel
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width - queueDuration.implicitWidth - Style.space(10)
              text: queueRow.modelData.title +
                (queueRow.modelData.artist ? " — " + queueRow.modelData.artist : "")
              color: root.popupForeground
              font.family: root.popupFontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Text {
              id: queueDuration
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: root.music && queueRow.modelData.durationSeconds > 0
                ? Model.formatTime(queueRow.modelData.durationSeconds) : ""
              color: Qt.darker(root.popupForeground, 1.6)
              font.family: root.popupFontFamily
              font.pixelSize: Style.font.caption
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.music.jumpToQueueIndex(queueRow.modelData.index)
            }
          }
        }
      }

      Column {
        width: parent.width
        spacing: Style.space(4)
        visible: root.showRecentlyPlayed && !!root.music && root.music.recentTracks.length > 0

        PanelSeparator { foreground: root.popupForeground }

        Text {
          width: parent.width
          text: "Recently played"
          color: Qt.darker(root.popupForeground, 1.4)
          font.family: root.popupFontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Repeater {
          model: root.showRecentlyPlayed && root.music
            ? root.music.recentTracks.slice(0, 5) : []

          Item {
            id: historyRow
            required property var modelData
            width: parent.width
            height: historyLabel.implicitHeight + Style.space(4)

            Accessible.role: Accessible.ListItem
            Accessible.name: historyRow.modelData.title +
              (historyRow.modelData.artist ? " — " + historyRow.modelData.artist : "") +
              (historyRow.modelData.play ? ", replay" : ", open Apple Music")

            Text {
              id: historyLabel
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width
              text: historyRow.modelData.title +
                (historyRow.modelData.artist ? " — " + historyRow.modelData.artist : "")
              color: Qt.darker(root.popupForeground, 1.3)
              font.family: root.popupFontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
            MouseArea {
              anchors.fill: parent
              // Replayable rows carry an exact-song descriptor; legacy rows
              // keep the pre-existing focus behavior and must not imply replay.
              cursorShape: historyRow.modelData.play
                ? Qt.PointingHandCursor : Qt.ArrowCursor
              onClicked: if (root.music) {
                if (historyRow.modelData.play) root.music.replayTrack(historyRow.modelData)
                else root.music.openAppleMusic()
              }
            }
          }
        }
      }

      Button {
        anchors.horizontalCenter: parent.horizontalCenter
        text: "Open Apple Music"
        iconText: ""
        foreground: root.popupForeground
        onClicked: if (root.music) root.music.openAppleMusic()
      }
    }
  }
}
