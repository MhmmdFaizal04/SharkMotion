/**
 * SharkMotion Studio - Alight Motion XML Project Parser & Importer
 * Parses Alight Motion project XML presets (.xml) and converts them into
 * native SharkMotion multitrack project timeline states with layers, beatmarks,
 * Bezier curves, and WebGL effects.
 */

(function (window) {
  'use strict';

  function parseCubicBezier(bezierStr) {
    if (!bezierStr || bezierStr === 'none') return [0.0, 0.0, 1.0, 1.0];
    const parts = bezierStr.replace(/cubicBezier\s*/i, '').trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const x1 = Math.max(0, Math.min(1, parseFloat(parts[0]) || 0));
      const y1 = parseFloat(parts[1]) || 0;
      const x2 = Math.max(0, Math.min(1, parseFloat(parts[2]) || 1));
      const y2 = parseFloat(parts[3]) || 1;
      return [x1, y1, x2, y2];
    }
    return [0.0, 0.0, 1.0, 1.0];
  }

  // Alight Motion Effect ID to SharkMotion Effect definition mapping
  const AM_EFFECT_MAP = {
    'com.alightcreative.effects.tile': { id: 'tile', name: 'Tile' },
    'com.alightcreative.effects.motionblur4': { id: 'fsmb', name: 'FSMB (Motion Blur)' },
    'com.alightcreative.effects.lift': { id: 'exposure-gamma', name: 'Exposure / Gamma' },
    'com.alightcreative.effects.wavewarp2': { id: 'wave-warp', name: 'Wave Warp' },
    'com.alightcreative.effects.turbulentdisplace3': { id: 'warp', name: 'Warp' },
    'com.alightcreative.effects.transform': { id: 'transform', name: 'Transform' },
    'com.alightcreative.effects.hueshift': { id: 'hue-shift', name: 'Hue Shift' },
    'com.alightcreative.effects.sharpen': { id: 'sharpen', name: 'Sharpen' },
    'com.alightcreative.gradientoverlay2': { id: 'gradient-overlay', name: 'Gradient Overlay' },
    'com.alightcreative.effects.satvib': { id: 'saturation-vibrant', name: 'Saturation / Vibrant' },
    'com.alightcreative.effects.lightglow': { id: 'deep-glow', name: 'Deep Glow' },
    'com.alightcreative.effects.unsharpmask': { id: 'unsharp-mask', name: 'Unsharp Mask' }
  };

  // Fallback tree parser for environments without full DOMParser
  function parseXMLToTree(xml) {
    xml = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').trim();
    let pos = 0;
    function parseNode() {
      while (pos < xml.length && xml[pos] !== '<') pos++;
      if (pos >= xml.length) return null;

      if (xml.startsWith('</', pos)) {
        const closeEnd = xml.indexOf('>', pos);
        pos = closeEnd + 1;
        return null;
      }

      const tagStart = pos + 1;
      const tagEnd = xml.indexOf('>', pos);
      let tagStr = xml.substring(tagStart, tagEnd).trim();
      const isSelfClosing = tagStr.endsWith('/');
      if (isSelfClosing) tagStr = tagStr.slice(0, -1).trim();

      const firstSpace = tagStr.search(/\s/);
      let tagName = '';
      let attrsStr = '';
      if (firstSpace === -1) {
        tagName = tagStr;
      } else {
        tagName = tagStr.substring(0, firstSpace);
        attrsStr = tagStr.substring(firstSpace).trim();
      }

      const attributes = {};
      const attrRegex = /([a-zA-Z0-9_\-:]+)="([^"]*)"/g;
      let am;
      while ((am = attrRegex.exec(attrsStr)) !== null) {
        attributes[am[1]] = am[2];
      }

      const node = {
        tagName,
        attributes,
        getAttribute(name) { return attributes[name] !== undefined ? attributes[name] : null; },
        children: [],
        querySelector(selector) {
          for (const c of this.children) {
            if (c.tagName.toLowerCase() === selector.toLowerCase()) return c;
            const nested = c.querySelector(selector);
            if (nested) return nested;
          }
          return null;
        },
        querySelectorAll(selector) {
          const res = [];
          for (const c of this.children) {
            if (c.tagName.toLowerCase() === selector.toLowerCase()) res.push(c);
            res.push(...c.querySelectorAll(selector));
          }
          return res;
        }
      };

      pos = tagEnd + 1;
      if (isSelfClosing) return node;

      while (pos < xml.length) {
        while (pos < xml.length && xml[pos] !== '<') pos++;
        if (pos >= xml.length) break;

        if (xml.startsWith('</' + tagName, pos)) {
          pos = xml.indexOf('>', pos) + 1;
          break;
        }

        if (xml.startsWith('</', pos)) {
          pos = xml.indexOf('>', pos) + 1;
          continue;
        }

        const child = parseNode();
        if (child) node.children.push(child);
      }

      return node;
    }

    return parseNode();
  }

  /**
   * Checks if an XML text string is an Alight Motion preset/project.
   */
  function isAlightMotionXML(text) {
    if (!text || typeof text !== 'string') return false;
    return text.includes('<scene') && (
      text.includes('com.alightcreative.motion') ||
      text.includes('<bookmark') ||
      text.includes('<shape') ||
      text.includes('amver=')
    );
  }

  /**
   * Converts Alight Motion XML string into a SharkMotion project data structure.
   */
  function parseXML(xmlText, fileName) {
    let doc = null;
    if (typeof window !== 'undefined' && window.DOMParser) {
      try {
        doc = new window.DOMParser().parseFromString(xmlText, 'application/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
          console.warn('[AlightMotionParser] Native DOMParser reported error, falling back to internal parser:', parseError.textContent);
          doc = parseXMLToTree(xmlText);
        }
      } catch (_) {
        doc = parseXMLToTree(xmlText);
      }
    } else {
      doc = parseXMLToTree(xmlText);
    }

    let sceneNode = null;
    if (doc.tagName && doc.tagName.toLowerCase() === 'scene') {
      sceneNode = doc;
    } else if (typeof doc.querySelector === 'function') {
      sceneNode = doc.querySelector('scene');
    }

    if (!sceneNode) {
      throw new Error("Invalid Alight Motion XML: No <scene> root element found.");
    }

    const width = parseInt(sceneNode.getAttribute('width') || '1080', 10);
    const height = parseInt(sceneNode.getAttribute('height') || '1920', 10);
    const fps = parseInt(sceneNode.getAttribute('fps') || '60', 10);
    const totalTimeMs = parseInt(sceneNode.getAttribute('totalTime') || '5000', 10);
    const defaultDuration = Number((totalTimeMs / 1000).toFixed(4));
    const fallbackName = (fileName || 'AlightMotion_Project').replace(/\.xml$/i, '');
    const title = sceneNode.getAttribute('title') || fallbackName;
    const bgcolor = sceneNode.getAttribute('bgcolor') || '#ff000000';

    // Compute Canvas Aspect Ratio
    let aspectRatio = '16:9';
    const ratio = width / height;
    if (Math.abs(ratio - 9/16) < 0.05) aspectRatio = '9:16';
    else if (Math.abs(ratio - 1) < 0.05) aspectRatio = '1:1';
    else if (Math.abs(ratio - 4/3) < 0.05) aspectRatio = '4:3';
    else if (Math.abs(ratio - 21/9) < 0.05) aspectRatio = '21:9';

    // Compute Resolution Category
    let resolution = '1080p';
    const minDim = Math.min(width, height);
    if (minDim >= 2160) resolution = '4K';
    else if (minDim >= 1440) resolution = '2K';
    else if (minDim >= 1080) resolution = '1080p';
    else if (minDim >= 720) resolution = '720p';
    else resolution = '480p';

    // Extract beatmarks (<bookmark t="...">)
    const beatmarks = [];
    const bookmarkNodes = Array.from(sceneNode.querySelectorAll('bookmark'));
    bookmarkNodes.forEach(bm => {
      const tMs = parseInt(bm.getAttribute('t') || '0', 10);
      if (!isNaN(tMs)) beatmarks.push(Number((tMs / 1000).toFixed(4)));
    });
    beatmarks.sort((a, b) => a - b);

    // Extract declared media assets (<media .../>)
    const mediaMap = new Map();
    const declaredMediaList = [];
    const mediaNodes = Array.from(sceneNode.querySelectorAll('media'));
    mediaNodes.forEach(m => {
      const uri = m.getAttribute('uri');
      if (!uri) return;
      const filename = m.getAttribute('filename') || m.getAttribute('title') || uri.split('/').pop() || 'Media';
      const mimeType = m.getAttribute('type') || '';
      const type = mimeType.startsWith('video/') ? 'video' : (mimeType.startsWith('audio/') ? 'audio' : 'image');
      const mediaItem = {
        id: 'med_' + Math.random().toString(36).substring(2, 8),
        uri: uri,
        name: filename,
        filename: filename,
        type: type,
        mimeType: mimeType,
        size: parseInt(m.getAttribute('size') || '0', 10) || 0,
        width: parseInt(m.getAttribute('width') || '0', 10) || width,
        height: parseInt(m.getAttribute('height') || '0', 10) || height,
        duration: parseInt(m.getAttribute('duration') || '0', 10) / 1000000 || null,
        dataUrl: '',
        isPlaceholder: true
      };
      mediaMap.set(uri, mediaItem);
      declaredMediaList.push(mediaItem);
    });

    const pps = 80;
    const layers = [];

    function processLayerNode(node, compWidth, compHeight, parentCompDurationMs) {
      const tag = node.tagName.toLowerCase();
      const origId = node.getAttribute('id');
      const layerId = origId ? ('layer_' + origId) : ('layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
      const label = node.getAttribute('label') || tag;
      const startMs = parseInt(node.getAttribute('startTime') || '0', 10);
      const endMs = parseInt(node.getAttribute('endTime') || String(parentCompDurationMs), 10);
      const durMs = Math.max(1, endMs - startMs);
      const startSec = Number((startMs / 1000).toFixed(4));
      const durationSec = Number((durMs / 1000).toFixed(4));
      const parentAttr = node.getAttribute('parent');
      const parentId = parentAttr ? ('layer_' + parentAttr) : null;

      let layerType = 'shape';
      let isSolid = false;
      let fillColor = '#ffffff';
      let mediaRef = null;
      let childLayers = null;

      if (tag === 'audio') {
        layerType = 'audio';
        const srcUri = node.getAttribute('src');
        mediaRef = mediaMap.get(srcUri);
      } else if (tag === 'nullobj') {
        layerType = 'null';
      } else if (tag === 'embedscene') {
        layerType = 'precomp';
        childLayers = [];
        const innerShapes = Array.from(node.querySelectorAll('shape'));
        innerShapes.forEach(ishape => {
          const cl = processLayerNode(ishape, compWidth, compHeight, durMs);
          if (cl) childLayers.push(cl);
        });
      } else if (tag === 'shape') {
        const fillType = node.getAttribute('fillType') || 'color';
        const fillVideo = node.getAttribute('fillVideo');
        const fillImage = node.getAttribute('fillImage');

        if (fillVideo) {
          layerType = 'video';
          mediaRef = mediaMap.get(fillVideo);
        } else if (fillImage) {
          layerType = 'image';
          mediaRef = mediaMap.get(fillImage);
        } else if (fillType === 'color') {
          layerType = 'shape';
          isSolid = true;
          const fcNode = node.querySelector('fillColor');
          if (fcNode && fcNode.getAttribute('value')) {
            fillColor = fcNode.getAttribute('value');
          }
        } else if (fillType === 'media') {
          layerType = 'image';
        }
      }

      const layer = {
        id: layerId,
        originalAmId: origId,
        name: label,
        type: layerType,
        isSolid: isSolid,
        shapeType: isSolid ? 'rectangle' : undefined,
        fillColor: isSolid ? fillColor : undefined,
        mediaId: mediaRef ? mediaRef.id : null,
        missingMediaName: mediaRef ? mediaRef.name : (label || null),
        startSec: startSec,
        durationSec: durationSec,
        startPx: Math.round(startSec * pps),
        widthPx: Math.max(1, Math.round(durationSec * pps)),
        parentId: parentId,
        posX: compWidth / 2,
        posY: compHeight / 2,
        posZ: 0,
        scaleW: compWidth,
        scaleH: compHeight,
        rotation: 0,
        rotZ: 0,
        opacity: 1.0,
        volume: 1.0,
        keyframes: {},
        effects: []
      };

      if (childLayers && childLayers.length > 0) {
        layer.layers = childLayers;
      }

      // Parse <transform>
      const transformNode = node.querySelector('transform');
      if (transformNode) {
        // Location
        const locNode = transformNode.querySelector('location');
        if (locNode) {
          const valStr = locNode.getAttribute('value');
          if (valStr) {
            const coords = valStr.split(',').map(Number);
            layer.posX = coords[0];
            layer.posY = coords[1];
            layer.posZ = coords[2] || 0;
          }
          const kfs = [];
          Array.from(locNode.querySelectorAll('kf')).forEach(kfNode => {
            const tNorm = parseFloat(kfNode.getAttribute('t') || '0');
            const kfSec = Number(((startMs + tNorm * durMs) / 1000).toFixed(4));
            const coords = (kfNode.getAttribute('v') || '').split(',').map(Number);
            kfs.push({
              time: kfSec,
              value: { posX: coords[0] || (compWidth/2), posY: coords[1] || (compHeight/2), posZ: coords[2] || 0 },
              easing: parseCubicBezier(kfNode.getAttribute('e'))
            });
          });
          if (kfs.length > 0) {
            layer.keyframes['move'] = kfs;
          }
        }

        // Scale
        const scaleNode = transformNode.querySelector('scale');
        if (scaleNode) {
          const valStr = scaleNode.getAttribute('value');
          if (valStr) {
            const sVals = valStr.split(',').map(Number);
            layer.scaleW = Math.round(compWidth * (sVals[0] !== undefined ? sVals[0] : 1));
            layer.scaleH = Math.round(compHeight * (sVals[1] !== undefined ? sVals[1] : 1));
          }
          const kfs = [];
          Array.from(scaleNode.querySelectorAll('kf')).forEach(kfNode => {
            const tNorm = parseFloat(kfNode.getAttribute('t') || '0');
            const kfSec = Number(((startMs + tNorm * durMs) / 1000).toFixed(4));
            const sVals = (kfNode.getAttribute('v') || '').split(',').map(Number);
            kfs.push({
              time: kfSec,
              value: {
                scaleW: Math.round(compWidth * (sVals[0] !== undefined ? sVals[0] : 1)),
                scaleH: Math.round(compHeight * (sVals[1] !== undefined ? sVals[1] : 1))
              },
              easing: parseCubicBezier(kfNode.getAttribute('e'))
            });
          });
          if (kfs.length > 0) {
            layer.keyframes['scale'] = kfs;
          }
        }

        // Rotation
        const rotNode = transformNode.querySelector('rotation');
        if (rotNode) {
          const valStr = rotNode.getAttribute('value');
          if (valStr) {
            const deg = parseFloat(valStr) || 0;
            layer.rotation = deg;
            layer.rotZ = deg;
          }
          const kfs = [];
          Array.from(rotNode.querySelectorAll('kf')).forEach(kfNode => {
            const tNorm = parseFloat(kfNode.getAttribute('t') || '0');
            const kfSec = Number(((startMs + tNorm * durMs) / 1000).toFixed(4));
            const deg = parseFloat(kfNode.getAttribute('v') || '0') || 0;
            kfs.push({
              time: kfSec,
              value: { rotZ: deg, rotation: deg },
              easing: parseCubicBezier(kfNode.getAttribute('e'))
            });
          });
          if (kfs.length > 0) {
            layer.keyframes['rotate'] = kfs;
          }
        }

        // Opacity
        const opNode = transformNode.querySelector('opacity');
        if (opNode) {
          const valStr = opNode.getAttribute('value');
          if (valStr) {
            layer.opacity = parseFloat(valStr) || 1.0;
          }
          const kfs = [];
          Array.from(opNode.querySelectorAll('kf')).forEach(kfNode => {
            const tNorm = parseFloat(kfNode.getAttribute('t') || '0');
            const kfSec = Number(((startMs + tNorm * durMs) / 1000).toFixed(4));
            const opVal = Math.max(0, Math.min(1, parseFloat(kfNode.getAttribute('v') || '1') || 0));
            kfs.push({
              time: kfSec,
              value: { opacity: opVal },
              easing: parseCubicBezier(kfNode.getAttribute('e'))
            });
          });
          if (kfs.length > 0) {
            layer.keyframes['opacity'] = kfs;
          }
        }
      }

      // Parse <effect>
      Array.from(node.querySelectorAll('effect')).forEach(fxNode => {
        const amFxId = fxNode.getAttribute('id');
        const def = AM_EFFECT_MAP[amFxId];
        const sharkFxType = def ? def.id : (amFxId ? amFxId.split('.').pop() : 'tile');
        const fxName = def ? def.name : sharkFxType;
        const fxInstanceId = 'fx_' + sharkFxType.replace(/[^a-z0-9]/gi, '_') + '_' + Math.random().toString(36).substring(2, 6);

        const fxInstance = {
          id: fxInstanceId,
          type: sharkFxType,
          name: fxName,
          isExpanded: true,
          disabled: false
        };

        Array.from(fxNode.querySelectorAll('property')).forEach(pNode => {
          const pName = pNode.getAttribute('name');
          if (!pName) return;
          const pVal = pNode.getAttribute('value');

          if (pVal !== null && pVal !== '') {
            if (pVal === 'true') fxInstance[pName] = 1;
            else if (pVal === 'false') fxInstance[pName] = 0;
            else {
              const num = parseFloat(pVal);
              fxInstance[pName] = isNaN(num) ? pVal : num;
            }
          }

          const kfNodes = Array.from(pNode.querySelectorAll('kf'));
          if (kfNodes.length > 0) {
            const kfs = [];
            kfNodes.forEach(kn => {
              const tNorm = parseFloat(kn.getAttribute('t') || '0');
              const kfSec = Number(((startMs + tNorm * durMs) / 1000).toFixed(4));
              let val = parseFloat(kn.getAttribute('v') || '0');
              if (isNaN(val)) val = kn.getAttribute('v');
              kfs.push({
                time: kfSec,
                value: val,
                easing: parseCubicBezier(kn.getAttribute('e'))
              });
            });
            if (kfs.length > 0) {
              const scopedKey = `${fxInstanceId}:${pName}`;
              layer.keyframes[scopedKey] = kfs;
              if (fxInstance[pName] === undefined) {
                fxInstance[pName] = kfs[0].value;
              }
            }
          }
        });

        layer.effects.push(fxInstance);
      });

      if (Object.keys(layer.keyframes).length === 0) delete layer.keyframes;
      return layer;
    }

    // Iterate direct scene children
    for (const child of sceneNode.children) {
      const tagName = child.tagName.toLowerCase();
      if (tagName === 'shape' || tagName === 'nullobj' || tagName === 'audio' || tagName === 'embedscene') {
        const l = processLayerNode(child, width, height, totalTimeMs);
        if (l) layers.push(l);
      }
    }

    const projectId = 'prj_am_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const cleanBgColor = bgcolor.length === 9 ? ('#' + bgcolor.substring(3)) : bgcolor;

    return {
      id: projectId,
      name: title,
      aspectRatio: aspectRatio,
      resolution: resolution,
      fps: fps,
      bgColor: cleanBgColor,
      defaultDuration: defaultDuration,
      beatmarks: beatmarks,
      media: declaredMediaList,
      layers: layers,
      isTemplate: true,
      idleCache: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Reads a File object and parses it into a SharkMotion project.
   */
  async function importXMLFile(file) {
    if (!file) throw new Error("No file provided");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const xmlText = e.target.result;
          const project = parseXML(xmlText, file.name);
          resolve(project);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read XML file"));
      reader.readAsText(file);
    });
  }

  window.AlightMotionParser = {
    isAlightMotionXML: isAlightMotionXML,
    parseXML: parseXML,
    importXMLFile: importXMLFile
  };

})(typeof window !== 'undefined' ? window : global);
