// --- Updated Perspective Helper ---
async function transformTruePerspective(layerId, side, fov, wallAngle) {
  const pBase = fov * 0.003;
  const perspectiveValue = side === "left" ? pBase : -pBase;

  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: wallAngle },
    using: { 
      _obj: "paint", 
      horizontal: { _unit: "percentUnit", _value: perspectiveValue }, 
      vertical: { _unit: "pixelsUnit", _value: 0 } 
    },
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" }
  }], { synchronousExecution: true });
}

// --- Full Replacement apply3DWall ---
async function apply3DWall() {
  const doc = app.activeDocument;
  if (!doc) return;

  const rawCamHeight = getVal("camHeight") || 50; 
  const fov = getVal("fov") || 5;
  const wallAngle = getVal("wallAngle") || 70;
  const wallType = document.querySelector('input[name="wallType"]:checked').value;
  const camAdjRefl = document.getElementById("camAdjRefl") && document.getElementById("camAdjRefl").checked;
  
  setStatus("Applying 3D Perspective...");
  const origDocH = doc.height;
  const origDocW = doc.width;

  try {
    // 1. Convert visible layers to a Smart Object
    await action.batchPlay([{ _obj: "selectAllLayers", _target: [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }] }], { synchronousExecution: true });
    const bgLayer = doc.layers.find(l => l.isBackgroundLayer || (l.name === "Background" && l.locked));
    if (bgLayer) {
        await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: bgLayer.id }], selectionModifier: { _enum: "selectionModifierType", _value: "removeFromSelection" } }], { synchronousExecution: true });
    }
    await action.batchPlay([{ _obj: "newPlacedLayer" }], { synchronousExecution: true });

    // 2. Padding Logic to Center Horizon
    const horizonOffset = camAdjRefl ? (rawCamHeight / 200) : (rawCamHeight / 100);
    const padNeeded = Math.round(origDocH * horizonOffset * 2);
    const totalH = origDocH + padNeeded;
    
    if (padNeeded > 0) {
       await action.batchPlay([{
          _obj: "canvasSize",
          height: { _unit: "pixelsUnit", _value: totalH },
          vertical: { _enum: "verticalLocation", _value: "bottomLocation" }
       }], { synchronousExecution: true });
    }

    // 3. Anchor Pixels to force transform center
    const drawAnchor = async (y) => {
      await action.batchPlay([{
        _obj: "make", _target: [{_ref: "contentLayer"}],
        using: {
          _obj: "contentLayer", 
          type: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: 0, green: 0, blue: 0 }}, 
          shape: { _obj: "rectangle", top: y, left: 0, bottom: y + 1, right: 1 }
        }
      }], { synchronousExecution: true });
    };
    await drawAnchor(0);
    await drawAnchor(totalH - 1);

    // 4. Final Smart Object Wrap of Wall + Anchors
    await action.batchPlay([{ _obj: "selectAllLayers", _target: [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }] }], { synchronousExecution: true });
    await action.batchPlay([{ _obj: "newPlacedLayer" }], { synchronousExecution: true });
    const activeSO = doc.activeLayers[0];

    // 5. Apply Transforms
    if (wallType === "single-left" || wallType === "single-right") {
      const side = wallType === "single-left" ? "left" : "right";
      await transformTruePerspective(activeSO.id, side, fov, wallAngle);
    } else if (wallType === "corner") {
      const leftLayerId = activeSO.id;
      await action.batchPlay([{ _obj: "duplicate", _target: [{ _ref: "layer", _id: leftLayerId }] }], { synchronousExecution: true });
      const rightLayerId = doc.activeLayers[0].id;
      
      await transformTruePerspective(rightLayerId, "right", fov, wallAngle);
      await selectLayerById(leftLayerId);
      await transformTruePerspective(leftLayerId, "left", fov, wallAngle);

      // Center seam alignment
      const centerX = doc.width / 2;
      const bLeft = await getActiveLayerBounds();
      await moveLayerBy(centerX - bLeft.right, 0);
      await selectLayerById(rightLayerId);
      const bRight = await getActiveLayerBounds();
      await moveLayerBy(centerX - bRight.left, 0);
    }
    
    // 6. Final Cleanup
    await action.batchPlay([{ _obj: "revealAll" }], { synchronousExecution: true });
    await action.batchPlay([{ _obj: "trim", trimBasedOn: { _enum: "trimBasedOn", _value: "transparentPixels" } }], { synchronousExecution: true });
    
    setStatus("Done!");
  } catch (err) {
    setStatus("Transform failed: " + err);
  }
}