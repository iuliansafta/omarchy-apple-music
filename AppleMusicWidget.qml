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
  readonly property bool showArtist: setting("showArtist", true)
  readonly property real maxLabelWidth: setting("maxLabelWidth", 220)
  // Collapse the slot when the dedicated Apple Music browser is not running
  // so it stops reserving bar space. Bar.qml sizes a slot to 0 when its
  // activeItem.visible is false, which is what this binding drives.
  readonly property bool hideWhenNotRunning: setting("hideWhenNotRunning", true)
  readonly property bool showQueue: setting("showQueue", true)
  readonly property bool showRecentlyPlayed: setting("showRecentlyPlayed", true)
  // Nerd Font nf-md glyphs, resolved from CaskaydiaMono Nerd Font's cmap:
  // md-heart, md-heart_outline, md-thumb_down, md-thumb_down_outline
  readonly property string heartIcon: String.fromCodePoint(0xf02d1)
  readonly property string heartOutlineIcon: String.fromCodePoint(0xf02d5)
  readonly property string thumbDownIcon: String.fromCodePoint(0xf0511)
  readonly property string thumbDownOutlineIcon: String.fromCodePoint(0xf0512)
  visible: !hideWhenNotRunning || (music && music.running)
  readonly property string trackLabel: {
    if (!music || !music.hasMedia) return "Music"
    if (showArtist && music.artist) return music.artist + " — " + music.title
    return music.title || music.artist
  }
  readonly property string playbackIcon: music && music.playing ? "󰏤" : "󰐊"

  property bool popupOpen: false
  readonly property bool opened: popupOpen

  function open() { popupOpen = true }
  function close() { popupOpen = false }
  function toggle() { popupOpen = !popupOpen }

  onVisibleChanged: if (!visible) popupOpen = false

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

  implicitWidth: row.implicitWidth + Style.space(14)
  implicitHeight: barSize

  Row {
    id: row
    anchors.centerIn: parent
    spacing: Style.space(6)

    Item {
      width: Style.bar.iconCanvas
      height: Style.bar.iconCanvas
      anchors.verticalCenter: parent.verticalCenter
      // Font Awesome's Apple mark paints below the visual center even when
      // its baseline matches neighboring status icons.
      anchors.verticalCenterOffset: -1.5

      OpticalGlyph {
        anchors.fill: parent
        text: ""
        color: root.bar ? root.bar.barForeground : Color.foreground
        fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
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
        // Center the label's 24px painted bounds against the 22px icon.
        anchors.verticalCenterOffset: -0.5
        text: root.trackLabel
        color: root.bar ? root.bar.barForeground : Color.foreground
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
        width: Math.min(root.maxLabelWidth, implicitWidth)
      }
    }

  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton

    onClicked: function(mouse) { root.triggerPress(mouse.button) }
    onWheel: function(wheel) {
      if (!root.music || !root.music.available) return
      if (wheel.angleDelta.y > 0) root.music.previous()
      else if (wheel.angleDelta.y < 0) root.music.next()
    }
    onEntered: if (root.bar) root.bar.showTooltip(root, root.trackLabel)
    onExited: if (root.bar) root.bar.hideTooltip(root)
  }

  Image {
    id: artworkProbe
    visible: false
    asynchronous: true
    cache: false
    source: root.music ? root.music.artUrl : ""
    onSourceChanged: if (source === "") root.readyArtUrl = ""
    onStatusChanged: if (status === Image.Ready) root.readyArtUrl = source
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
          color: Style.normalFillFor(root.bar.foreground, Color.accent)
          borderSpec: Border.controlSpec("normal", root.bar.foreground, Color.accent)

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
            color: root.bar.foreground
            font.family: root.bar.fontFamily
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
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            text: root.music ? root.music.artist : ""
            visible: text !== ""
            color: Qt.darker(root.bar.foreground, 1.3)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            text: root.music ? root.music.album : ""
            visible: text !== ""
            color: Qt.darker(root.bar.foreground, 1.6)
            font.family: root.bar.fontFamily
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
          color: Util.alpha(root.bar.foreground, 0.2)

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
            color: Qt.darker(root.bar.foreground, 1.4)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }

          Item { width: parent.width - elapsed.implicitWidth - duration.implicitWidth; height: 1 }

          Text {
            id: duration
            text: root.music ? root.music.lengthText : "--:--"
            color: Qt.darker(root.bar.foreground, 1.4)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Text {
          width: parent.width
          visible: !!root.music && !root.music.hasValidLength
          text: "Apple Music does not expose track duration"
          horizontalAlignment: Text.AlignHCenter
          color: Qt.darker(root.bar.foreground, 1.6)
          font.family: root.bar.fontFamily
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
          foreground: root.bar.foreground
          enabled: !!root.music && root.music.available && root.music.activePlayer.canGoPrevious
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.previous()
        }

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: root.playbackIcon
          foreground: root.bar.foreground
          iconSize: Style.font.iconLarge
          enabled: !!root.music && root.music.available
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.togglePlayback()
        }

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: "󰒭"
          foreground: root.bar.foreground
          enabled: !!root.music && root.music.available && root.music.activePlayer.canGoNext
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.next()
        }
      }

      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: Style.space(8)

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: root.music && root.music.rating === "like"
            ? root.heartIcon : root.heartOutlineIcon
          foreground: root.music && root.music.rating === "like"
            ? Color.accent : root.bar.foreground
          enabled: !!root.music && root.music.bridgeActive
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.toggleLike()
        }

        Button {
          width: Style.space(44)
          height: Style.space(40)
          iconText: root.music && root.music.rating === "dislike"
            ? root.thumbDownIcon : root.thumbDownOutlineIcon
          foreground: root.music && root.music.rating === "dislike"
            ? Color.accent : root.bar.foreground
          enabled: !!root.music && root.music.bridgeActive
          opacity: enabled ? 1 : 0.4
          onClicked: root.music.toggleDislike()
        }
      }

      Column {
        width: parent.width
        spacing: Style.space(4)
        visible: root.showQueue && !!root.music && root.music.upNext.length > 0

        PanelSeparator { foreground: root.bar.foreground }

        Text {
          width: parent.width
          text: "Up next"
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
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
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Text {
              id: queueDuration
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: root.music && queueRow.modelData.durationSeconds > 0
                ? Model.formatTime(queueRow.modelData.durationSeconds) : ""
              color: Qt.darker(root.bar.foreground, 1.6)
              font.family: root.bar.fontFamily
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

        PanelSeparator { foreground: root.bar.foreground }

        Text {
          width: parent.width
          text: "Recently played"
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
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

            Text {
              id: historyLabel
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width
              text: historyRow.modelData.title +
                (historyRow.modelData.artist ? " — " + historyRow.modelData.artist : "")
              color: Qt.darker(root.bar.foreground, 1.3)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: if (root.music) root.music.openAppleMusic()
            }
          }
        }
      }

      Button {
        anchors.horizontalCenter: parent.horizontalCenter
        text: "Open Apple Music"
        iconText: ""
        foreground: root.bar.foreground
        onClicked: if (root.music) root.music.openAppleMusic()
      }
    }
  }
}
