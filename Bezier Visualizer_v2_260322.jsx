(function(thisObj) {

    var USE_FULL_HIERARCHY_NAME = true;

    function esc(n){
        return String(n).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
    }

    function isShapeLayer(layer){
        return layer && (layer instanceof ShapeLayer);
    }

    function isOverlayLayer(layer){
        return layer && /^ANCHOR_OVERLAY_/.test(layer.name);
    }

    function getSourceLayerFromOverlay(overlay){
        if (!isOverlayLayer(overlay)) return null;

        var sourceName = overlay.name.replace(/^ANCHOR_OVERLAY_/, "");
        var comp = overlay.containingComp;
        if (!comp) return null;

        for (var i = 1; i <= comp.numLayers; i++) {
            var lyr = comp.layer(i);
            if (lyr && lyr.name === sourceName && !isOverlayLayer(lyr)) {
                return lyr;
            }
        }
        return null;
    }

    function getPathProp(pathGroup){
        if(!pathGroup || typeof pathGroup.numProperties === "undefined") return null;

        for(var i=1;i<=pathGroup.numProperties;i++){
            var p = pathGroup.property(i);
            if(p && p.matchName === "ADBE Vector Shape"){
                return p;
            }
        }
        return null;
    }

    function buildLayerExpr(layer){
        return 'thisComp.layer("' + esc(layer.name) + '")';
    }

    function buildGroupExpr(layer, groupNames){
        var expr = buildLayerExpr(layer);
        for(var i=0;i<groupNames.length;i++){
            expr += '.content("' + esc(groupNames[i]) + '")';
        }
        return expr;
    }

    function buildPathExpr(layer, groupNames, pathGroupName){
        return buildGroupExpr(layer, groupNames) + '.content("' + esc(pathGroupName) + '").path';
    }

    function hexToRgbArray(str){
        if (!str) return null;

        var s = String(str).replace(/\s+/g, "");
        if (s.charAt(0) === "#") s = s.substring(1);

        if (s.length === 3){
            s = s.charAt(0)+s.charAt(0) + s.charAt(1)+s.charAt(1) + s.charAt(2)+s.charAt(2);
        }

        if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;

        return [
            parseInt(s.substring(0,2), 16) / 255,
            parseInt(s.substring(2,4), 16) / 255,
            parseInt(s.substring(4,6), 16) / 255
        ];
    }

    function normalizeHex(str){
        var rgb = hexToRgbArray(str);
        if (!rgb) return null;

        var s = String(str).replace(/\s+/g,"");
        if (s.charAt(0) === "#") s = s.substring(1);

        if (s.length === 3){
            s = s.charAt(0)+s.charAt(0) + s.charAt(1)+s.charAt(1) + s.charAt(2)+s.charAt(2);
        }

        return "#" + s.toUpperCase();
    }

    function setSwatchColor(swatch, rgb){
        if (!swatch || !rgb) return;
        try{
            swatch.graphics.backgroundColor = swatch.graphics.newBrush(
                swatch.graphics.BrushType.SOLID_COLOR,
                rgb
            );
        } catch(e){}
    }

    function ensureColorControl(fx, name, value){
        var p = fx.property(name);
        if(!p){
            p = fx.addProperty("ADBE Color Control");
            p.name = name;
        }
        p.property(1).setValue(value);
        return p;
    }

    function ensureSliderControl(fx, name, value){
        var p = fx.property(name);
        if(!p){
            p = fx.addProperty("ADBE Slider Control");
            p.name = name;
        }
        p.property(1).setValue(value);
        return p;
    }

    function ensureCheckboxControl(fx, name, value){
        var p = fx.property(name);
        if(!p){
            p = fx.addProperty("ADBE Checkbox Control");
            p.name = name;
        }
        p.property(1).setValue(value ? 1 : 0);
        return p;
    }

    function setupOverlayControls(overlayLayer, opts){
        var fx = overlayLayer.property("ADBE Effect Parade");

        ensureColorControl(fx, "Anchor Color", opts.anchorColor);
        ensureColorControl(fx, "Handle Color", opts.handleColor);
        ensureColorControl(fx, "Line Color", opts.lineColor);

        ensureSliderControl(fx, "Anchor Size", opts.anchorSize);
        ensureSliderControl(fx, "Handle Size", opts.handleSize);
        ensureSliderControl(fx, "Line Width", opts.lineWidth);

        ensureCheckboxControl(fx, "Hide Zero Handles", opts.hideZeroHandles);
        ensureCheckboxControl(fx, "Show Handles", opts.showHandles);
        ensureCheckboxControl(fx, "Show Lines", opts.showLines);
        ensureCheckboxControl(fx, "Anchor Circle", opts.anchorShape === "Circle");
        ensureCheckboxControl(fx, "Handle Circle", opts.handleShape === "Circle");
    }

    function linkLayerTransform(overlayLayer, sourceLayer){
        var tr = overlayLayer.property("Transform");
        var src = buildLayerExpr(sourceLayer) + ".transform";

        tr.property("Anchor Point").expression = src + ".anchorPoint";
        tr.property("Position").expression     = src + ".position";
        tr.property("Scale").expression        = src + ".scale";
        tr.property("Rotation").expression     = src + ".rotation";

        if (tr.property("Opacity")) {
            tr.property("Opacity").expression = src + ".opacity";
        }
    }

    function linkVectorGroupTransform(destGroup, sourceLayer, groupNames){
        var srcExpr = buildGroupExpr(sourceLayer, groupNames) + '.transform';
        var tr = destGroup.property("ADBE Vector Transform Group");

        tr.property("ADBE Vector Anchor").expression   = srcExpr + '.anchorPoint';
        tr.property("ADBE Vector Position").expression = srcExpr + '.position';
        tr.property("ADBE Vector Scale").expression    = srcExpr + '.scale';
        tr.property("ADBE Vector Rotation").expression = srcExpr + '.rotation';

        if (tr.property("ADBE Vector Group Opacity")) {
            tr.property("ADBE Vector Group Opacity").expression = srcExpr + '.opacity';
        }
        if (tr.property("ADBE Vector Skew")) {
            tr.property("ADBE Vector Skew").expression = srcExpr + '.skew';
        }
        if (tr.property("ADBE Vector Skew Axis")) {
            tr.property("ADBE Vector Skew Axis").expression = srcExpr + '.skewAxis';
        }
    }

    function addAnchorSquares(destContents, sourceLayer, overlayLayer, groupNames, pathGroup){
        var pathProp = getPathProp(pathGroup);
        if(!pathProp) return;

        var pathVal;
        try{
            pathVal = pathProp.value;
        }catch(e){
            return;
        }

        if(!pathVal || !pathVal.vertices || pathVal.vertices.length === 0) return;

        var pathExpr = buildPathExpr(sourceLayer, groupNames, pathGroup.name);
        var overlayExpr = buildLayerExpr(overlayLayer);

        var anchorSet = destContents.addProperty("ADBE Vector Group");
        anchorSet.name = "_ANCHORS_" + pathGroup.name;

        var anchorContents = anchorSet.property("Contents");

        for(var i=0;i<pathVal.vertices.length;i++){
            var sq = anchorContents.addProperty("ADBE Vector Group");
            sq.name = "Anchor_" + i;

            var sqContents = sq.property("Contents");

            var rect = sqContents.addProperty("ADBE Vector Shape - Rect");
            rect.property("Size").expression =
                'var s = ' + overlayExpr + '.effect("Anchor Size")("Slider");\n[s, s];';
            rect.property("Roundness").expression =
                'var isCircle = ' + overlayExpr + '.effect("Anchor Circle")("Checkbox");\n' +
                'var s = ' + overlayExpr + '.effect("Anchor Size")("Slider");\n' +
                'if (isCircle == 1) s/2; else 0;';

            var fill = sqContents.addProperty("ADBE Vector Graphic - Fill");
            fill.property("Color").expression =
                overlayExpr + '.effect("Anchor Color")("Color")';

            sq.property("Transform").property("Position").expression =
                'var p = ' + pathExpr + ';\n' +
                'p.points()[' + i + '];';
        }
    }

    function addBezierHandles(destContents, sourceLayer, overlayLayer, groupNames, pathGroup){
        var pathProp = getPathProp(pathGroup);
        if(!pathProp) return;

        var pathVal;
        try{
            pathVal = pathProp.value;
        }catch(e){
            return;
        }

        if(!pathVal || !pathVal.vertices || pathVal.vertices.length === 0) return;

        var pathExpr = buildPathExpr(sourceLayer, groupNames, pathGroup.name);
        var overlayExpr = buildLayerExpr(overlayLayer);

        var handleSet = destContents.addProperty("ADBE Vector Group");
        handleSet.name = "_HANDLES_" + pathGroup.name;

        var handleContents = handleSet.property("Contents");

        for(var i=0;i<pathVal.vertices.length;i++){

            var hideExprBase =
                'var p = ' + pathExpr + ';\n' +
                'var v = p.points()[' + i + '];\n' +
                'var it = p.inTangents()[' + i + '];\n' +
                'var ot = p.outTangents()[' + i + '];\n' +
                'var hide = ' + overlayExpr + '.effect("Hide Zero Handles")("Checkbox");\n';

            var lineGroup = handleContents.addProperty("ADBE Vector Group");
            lineGroup.name = "HandleLine_" + i;

            var lineContents = lineGroup.property("Contents");

            var linePath = lineContents.addProperty("ADBE Vector Shape - Group");
            linePath.property("Path").expression =
                hideExprBase +
                'var showLines = ' + overlayExpr + '.effect("Show Lines")("Checkbox");\n' +
                'var iLen = length(it);\n' +
                'var oLen = length(ot);\n' +
                'if (showLines == 0 || (hide == 1 && iLen == 0 && oLen == 0)){\n' +
                '  createPath([], [], [], false);\n' +
                '} else {\n' +
                '  var iH = [v[0] + it[0], v[1] + it[1]];\n' +
                '  var oH = [v[0] + ot[0], v[1] + ot[1]];\n' +
                '  createPath([iH, v, oH], [], [], false);\n' +
                '}';

            var lineStroke = lineContents.addProperty("ADBE Vector Graphic - Stroke");
            lineStroke.property("Color").expression =
                overlayExpr + '.effect("Line Color")("Color")';
            lineStroke.property("Stroke Width").expression =
                overlayExpr + '.effect("Line Width")("Slider")';

            var inGroup = handleContents.addProperty("ADBE Vector Group");
            inGroup.name = "InHandle_" + i;

            var inContents = inGroup.property("Contents");
            var inShape = inContents.addProperty("ADBE Vector Shape - Rect");
            inShape.property("Size").expression =
                'var s = ' + overlayExpr + '.effect("Handle Size")("Slider");\n[s, s];';
            inShape.property("Roundness").expression =
                'var isCircle = ' + overlayExpr + '.effect("Handle Circle")("Checkbox");\n' +
                'var s = ' + overlayExpr + '.effect("Handle Size")("Slider");\n' +
                'if (isCircle == 1) s/2; else 0;';

            var inFill = inContents.addProperty("ADBE Vector Graphic - Fill");
            inFill.property("Color").expression =
                overlayExpr + '.effect("Handle Color")("Color")';

            inGroup.property("Transform").property("Position").expression =
                'var p = ' + pathExpr + ';\n' +
                'var v = p.points()[' + i + '];\n' +
                'var t = p.inTangents()[' + i + '];\n' +
                '[v[0] + t[0], v[1] + t[1]];';

            inGroup.property("Transform").property("Opacity").expression =
                'var p = ' + pathExpr + ';\n' +
                'var t = p.inTangents()[' + i + '];\n' +
                'var hide = ' + overlayExpr + '.effect("Hide Zero Handles")("Checkbox");\n' +
                'if (hide == 1 && length(t) == 0) 0 else 100;';

            var outGroup = handleContents.addProperty("ADBE Vector Group");
            outGroup.name = "OutHandle_" + i;

            var outContents = outGroup.property("Contents");
            var outShape = outContents.addProperty("ADBE Vector Shape - Rect");
            outShape.property("Size").expression =
                'var s = ' + overlayExpr + '.effect("Handle Size")("Slider");\n[s, s];';
            outShape.property("Roundness").expression =
                'var isCircle = ' + overlayExpr + '.effect("Handle Circle")("Checkbox");\n' +
                'var s = ' + overlayExpr + '.effect("Handle Size")("Slider");\n' +
                'if (isCircle == 1) s/2; else 0;';

            var outFill = outContents.addProperty("ADBE Vector Graphic - Fill");
            outFill.property("Color").expression =
                overlayExpr + '.effect("Handle Color")("Color")';

            outGroup.property("Transform").property("Position").expression =
                'var p = ' + pathExpr + ';\n' +
                'var v = p.points()[' + i + '];\n' +
                'var t = p.outTangents()[' + i + '];\n' +
                '[v[0] + t[0], v[1] + t[1]];';

            outGroup.property("Transform").property("Opacity").expression =
                'var p = ' + pathExpr + ';\n' +
                'var t = p.outTangents()[' + i + '];\n' +
                'var hide = ' + overlayExpr + '.effect("Hide Zero Handles")("Checkbox");\n' +
                'if (hide == 1 && length(t) == 0) 0 else 100;';
        }
    }

    function removeGeneratedHandleGroups(container){
        if (!container || typeof container.numProperties === "undefined") return;

        for (var i = container.numProperties; i >= 1; i--) {
            var prop = container.property(i);
            if (!prop) continue;

            if (prop.name && (/^_HANDLES_/.test(prop.name) || /^_ANCHORS_/.test(prop.name))) {
                prop.remove();
                continue;
            }

            if (prop.matchName === "ADBE Vector Group") {
                removeGeneratedHandleGroups(prop.property("Contents"));
            }
        }
    }

    function mirrorHandleContentsOnly(sourceContents, destContents, sourceLayer, overlayLayer, groupNames, opts){
        if(!sourceContents || typeof sourceContents.numProperties === "undefined") return;

        for(var i=1;i<=sourceContents.numProperties;i++){
            var prop = sourceContents.property(i);
            if(!prop) continue;

            if(prop.matchName === "ADBE Vector Group"){
                var targetGroup = destContents.property(prop.name);
                if (targetGroup && targetGroup.matchName === "ADBE Vector Group") {
                    var nextNames = groupNames.slice();
                    nextNames.push(prop.name);

                    mirrorHandleContentsOnly(
                        prop.property("Contents"),
                        targetGroup.property("Contents"),
                        sourceLayer,
                        overlayLayer,
                        nextNames,
                        opts
                    );
                }
            }
            else if(prop.matchName === "ADBE Vector Shape - Group"){
                addAnchorSquares(destContents, sourceLayer, overlayLayer, groupNames, prop);

                if (opts.showHandles) {
                    addBezierHandles(destContents, sourceLayer, overlayLayer, groupNames, prop);
                }
            }
        }
    }

    function mirrorContents(sourceContents, destContents, sourceLayer, overlayLayer, groupNames, opts){
        if(!sourceContents || typeof sourceContents.numProperties === "undefined") return;

        for(var i=1;i<=sourceContents.numProperties;i++){
            var prop = sourceContents.property(i);
            if(!prop) continue;

            if(prop.matchName === "ADBE Vector Group"){
                var newGroup = destContents.addProperty("ADBE Vector Group");
                newGroup.name = prop.name;

                var nextNames = groupNames.slice();
                nextNames.push(prop.name);

                linkVectorGroupTransform(newGroup, sourceLayer, nextNames);

                mirrorContents(
                    prop.property("Contents"),
                    newGroup.property("Contents"),
                    sourceLayer,
                    overlayLayer,
                    nextNames,
                    opts
                );
            }
            else if(prop.matchName === "ADBE Vector Shape - Group"){
                addAnchorSquares(destContents, sourceLayer, overlayLayer, groupNames, prop);

                if (opts.showHandles) {
                    addBezierHandles(destContents, sourceLayer, overlayLayer, groupNames, prop);
                }
            }
        }
    }

    function createOverlayForLayer(sourceLayer, opts){
        var comp = sourceLayer.containingComp;

        var overlay = comp.layers.addShape();
        overlay.name = "ANCHOR_OVERLAY_" + sourceLayer.name;
        overlay.moveToBeginning();

        setupOverlayControls(overlay, opts);
        linkLayerTransform(overlay, sourceLayer);

        mirrorContents(
            sourceLayer.property("Contents"),
            overlay.property("Contents"),
            sourceLayer,
            overlay,
            [],
            opts
        );

        return overlay;
    }

    function updateOverlayLayer(overlay, opts){
        var sourceLayer = getSourceLayerFromOverlay(overlay);
        if (!sourceLayer) return;

        setupOverlayControls(overlay, opts);

        removeGeneratedHandleGroups(overlay.property("Contents"));

        mirrorHandleContentsOnly(
            sourceLayer.property("Contents"),
            overlay.property("Contents"),
            sourceLayer,
            overlay,
            [],
            opts
        );

        overlay.moveToBeginning();
    }

    function findPathValueProperty(shapeGroup) {
        for (var i = 1; i <= shapeGroup.numProperties; i++) {
            var p = shapeGroup.property(i);
            if (p.matchName === "ADBE Vector Shape") {
                return p;
            }
        }
        return null;
    }

    function collectPathPropsRecursive(group, prefix, outArray) {
        if (!group || !group.numProperties) return;

        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            if (!p) continue;

            if (p.matchName === "ADBE Vector Shape - Group") {
                var pathProp = findPathValueProperty(p);
                if (pathProp) {
                    var keyName = USE_FULL_HIERARCHY_NAME
                        ? (prefix ? prefix + "/" + p.name : p.name)
                        : p.name;

                    outArray.push({
                        key: keyName,
                        name: p.name,
                        prop: pathProp,
                        group: p
                    });
                }
            }
            else if (p.matchName === "ADBE Vector Group") {
                var nextPrefix = USE_FULL_HIERARCHY_NAME
                    ? (prefix ? prefix + "/" + p.name : p.name)
                    : prefix;

                collectPathPropsRecursive(p, nextPrefix, outArray);
            }
            else if (p.numProperties && p.propertyType !== PropertyType.PROPERTY) {
                collectPathPropsRecursive(p, prefix, outArray);
            }
        }
    }

    function collectPathProps(shapeLayer) {
        var arr = [];
        var contents = shapeLayer.property("Contents");
        if (!contents) return arr;
        collectPathPropsRecursive(contents, "", arr);
        return arr;
    }

    function buildPathMap(pathArray) {
        var map = {};
        for (var i = 0; i < pathArray.length; i++) {
            map[pathArray[i].key] = pathArray[i];
        }
        return map;
    }

    function shapeCompatible(shapeA, shapeB) {
        if (!shapeA || !shapeB) return false;
        if (!shapeA.vertices || !shapeB.vertices) return false;
        if (shapeA.vertices.length !== shapeB.vertices.length) return false;
        if (!shapeA.inTangents || !shapeB.inTangents) return false;
        if (!shapeA.outTangents || !shapeB.outTangents) return false;
        if (shapeA.inTangents.length !== shapeB.inTangents.length) return false;
        if (shapeA.outTangents.length !== shapeB.outTangents.length) return false;
        if (shapeA.closed !== shapeB.closed) return false;
        return true;
    }

    function removeAllKeys(prop) {
        while (prop.numKeys > 0) {
            prop.removeKey(1);
        }
    }

    function createChainedMorphOnLayers(layers, duration){
        var result = {
            segments: [],
            totalMatched: 0,
            totalMissing: [],
            totalSkipped: []
        };

        if (!layers || layers.length < 2) {
            return result;
        }

        var baseLayer = layers[0];
        var comp = baseLayer.containingComp;
        var basePaths = collectPathProps(baseLayer);

        var keyInfo = {};
        for (var i = 0; i < basePaths.length; i++) {
            keyInfo[basePaths[i].key] = {
                prop: basePaths[i].prop,
                shapes: [],
                times: []
            };
        }

        for (var k in keyInfo) {
            if (!keyInfo.hasOwnProperty(k)) continue;
            try {
                keyInfo[k].shapes.push(keyInfo[k].prop.value);
                keyInfo[k].times.push(comp.time);
            } catch (e0) {}
        }

        for (var seg = 1; seg < layers.length; seg++) {
            var targetLayer = layers[seg];
            var targetPaths = collectPathProps(targetLayer);
            var targetMap = buildPathMap(targetPaths);
            var segMatched = 0;
            var segMissing = [];
            var segSkipped = [];
            var segTime = comp.time + (duration * seg);

            for (var key in keyInfo) {
                if (!keyInfo.hasOwnProperty(key)) continue;

                var prevShape = keyInfo[key].shapes[keyInfo[key].shapes.length - 1];

                if (!targetMap[key]) {
                    segMissing.push(key);
                    continue;
                }

                var targetShape;
                try {
                    targetShape = targetMap[key].prop.value;
                } catch (e1) {
                    segSkipped.push(key + " (Could not read path value)");
                    continue;
                }

                if (!shapeCompatible(prevShape, targetShape)) {
                    segSkipped.push(key + " (Vertex/tangent/closed mismatch)");
                    continue;
                }

                keyInfo[key].shapes.push(targetShape);
                keyInfo[key].times.push(segTime);
                segMatched++;
            }

            result.segments.push({
                fromLayer: layers[seg - 1].name,
                toLayer: targetLayer.name,
                matched: segMatched,
                missing: segMissing,
                skipped: segSkipped
            });

            result.totalMatched += segMatched;

            for (var m = 0; m < segMissing.length; m++) {
                result.totalMissing.push("[" + layers[seg - 1].name + " -> " + targetLayer.name + "] " + segMissing[m]);
            }
            for (var s = 0; s < segSkipped.length; s++) {
                result.totalSkipped.push("[" + layers[seg - 1].name + " -> " + targetLayer.name + "] " + segSkipped[s]);
            }
        }

        for (var pathKey in keyInfo) {
            if (!keyInfo.hasOwnProperty(pathKey)) continue;

            var info = keyInfo[pathKey];
            if (info.shapes.length < 2) continue;

            try {
                removeAllKeys(info.prop);
                for (var t = 0; t < info.shapes.length; t++) {
                    info.prop.setValueAtTime(info.times[t], info.shapes[t]);
                }
            } catch (e2) {
                result.totalSkipped.push("[Apply] " + pathKey + " (Failed to create keyframes)");
            }
        }

        return result;
    }

    function hideAllOtherShapeLayers(comp, visibleSourceLayer, overlayLayer){
        for (var i = 1; i <= comp.numLayers; i++) {
            var lyr = comp.layer(i);
            if (!lyr) continue;

            if (overlayLayer && lyr === overlayLayer) {
                lyr.enabled = true;
                continue;
            }

            if (visibleSourceLayer && lyr === visibleSourceLayer) {
                lyr.enabled = true;
                continue;
            }

            if (isOverlayLayer(lyr)) {
                lyr.enabled = false;
                continue;
            }

            if (isShapeLayer(lyr)) {
                lyr.enabled = false;
            }
        }
    }

    function addHexRow(parent, labelText, defaultHex){
        var g = parent.add("group");
        g.orientation = "row";
        g.alignChildren = ["left", "center"];

        g.add("statictext", undefined, labelText);

        var input = g.add("edittext", undefined, defaultHex);
        input.characters = 9;

        var swatch = g.add("panel", undefined, "");
        swatch.preferredSize = [22, 18];

        function refresh(){
            var rgb = hexToRgbArray(input.text);
            if (rgb) setSwatchColor(swatch, rgb);
        }

        input.onChanging = refresh;
        input.onChange = function(){
            var normalized = normalizeHex(input.text);
            if (normalized) input.text = normalized;
            refresh();
        };

        refresh();

        return {
            input: input
        };
    }

    function addLabeledNumberRow(parent, label, defaultValue, chars){
        var g = parent.add("group");
        g.orientation = "row";
        g.alignChildren = ["left", "center"];

        g.add("statictext", undefined, label);
        var input = g.add("edittext", undefined, defaultValue);
        input.characters = chars || 5;

        return input;
    }

    function buildUI(thisObj){
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "Anchor + Bezier Overlay Controller", undefined, {resizeable:true});

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 14;
        win.spacing = 8;

        var modePanel = win.add("panel", undefined, "Mode");
        modePanel.orientation = "row";
        modePanel.alignChildren = ["left", "center"];
        modePanel.margins = 10;

        var createRadio = modePanel.add("radiobutton", undefined, "Create Overlay / Auto Morph");
        var updateRadio = modePanel.add("radiobutton", undefined, "Update Selected Overlay");
        createRadio.value = true;

        var morphPanel = win.add("panel", undefined, "Morph");
        morphPanel.orientation = "column";
        morphPanel.alignChildren = ["left", "top"];
        morphPanel.margins = 10;

        var morphRow = morphPanel.add("group");
        morphRow.orientation = "row";
        morphRow.add("statictext", undefined, "Morph Duration");
        var morphDurationInput = morphRow.add("edittext", undefined, "1.0");
        morphDurationInput.characters = 5;
        morphRow.add("statictext", undefined, "sec");

        var anchorPanel = win.add("panel", undefined, "Anchor");
        anchorPanel.orientation = "column";
        anchorPanel.alignChildren = ["left", "top"];
        anchorPanel.margins = 10;

        var anchorSizeInput = addLabeledNumberRow(anchorPanel, "Size", "10", 5);
        var anchorColorRow = addHexRow(anchorPanel, "Color", "#FF0000");

        var anchorShapeGroup = anchorPanel.add("group");
        anchorShapeGroup.orientation = "row";
        anchorShapeGroup.add("statictext", undefined, "Shape");
        var anchorShapeDropdown = anchorShapeGroup.add("dropdownlist", undefined, ["Square", "Circle"]);
        anchorShapeDropdown.selection = 0;

        var handlePanel = win.add("panel", undefined, "Bezier Handles");
        handlePanel.orientation = "column";
        handlePanel.alignChildren = ["left", "top"];
        handlePanel.margins = 10;

        var handleSizeInput = addLabeledNumberRow(handlePanel, "Size", "6", 5);
        var handleColorRow = addHexRow(handlePanel, "Color", "#828282");

        var handleShapeGroup = handlePanel.add("group");
        handleShapeGroup.orientation = "row";
        handleShapeGroup.add("statictext", undefined, "Shape");
        var handleShapeDropdown = handleShapeGroup.add("dropdownlist", undefined, ["Square", "Circle"]);
        handleShapeDropdown.selection = 1;

        var linePanel = win.add("panel", undefined, "Handle Lines");
        linePanel.orientation = "column";
        linePanel.alignChildren = ["left", "top"];
        linePanel.margins = 10;

        var lineWidthInput = addLabeledNumberRow(linePanel, "Width", "1.5", 5);
        var lineColorRow = addHexRow(linePanel, "Color", "#828282");

        var displayPanel = win.add("panel", undefined, "Display");
        displayPanel.orientation = "column";
        displayPanel.alignChildren = ["left", "top"];
        displayPanel.margins = 10;

        var showHandlesChk = displayPanel.add("checkbox", undefined, "Create Handles");
        showHandlesChk.value = true;

        var hideZeroChk = displayPanel.add("checkbox", undefined, "Hide Zero Handles");
        hideZeroChk.value = true;

        var showLinesChk = displayPanel.add("checkbox", undefined, "Show Lines");
        showLinesChk.value = true;

        var btnPanel = win.add("panel", undefined, "Actions");
        btnPanel.orientation = "row";
        btnPanel.alignChildren = ["right", "center"];
        btnPanel.margins = 10;

        var runBtn = btnPanel.add("button", undefined, "Run");
        var closeBtn = btnPanel.add("button", undefined, "Close");

        var footer = win.add("statictext", undefined, "Developed by Jumyoung Lee");
        footer.alignment = "center";

        closeBtn.onClick = function(){
            if(win instanceof Window) win.close();
        };

        runBtn.onClick = function(){
            var comp = app.project.activeItem;

            if(!(comp instanceof CompItem)){
                alert("Please open a composition first.");
                return;
            }

            var anchorSize = parseFloat(anchorSizeInput.text);
            var handleSize = parseFloat(handleSizeInput.text);
            var lineWidth = parseFloat(lineWidthInput.text);
            var morphDuration = parseFloat(morphDurationInput.text);

            if(isNaN(anchorSize) || anchorSize <= 0){
                alert("Please enter a valid Anchor Size value.");
                return;
            }

            if(isNaN(handleSize) || handleSize <= 0){
                alert("Please enter a valid Handle Size value.");
                return;
            }

            if(isNaN(lineWidth) || lineWidth <= 0){
                alert("Please enter a valid Line Width value.");
                return;
            }

            if(isNaN(morphDuration) || morphDuration <= 0){
                alert("Please enter a valid Morph Duration value.");
                return;
            }

            var anchorColor = hexToRgbArray(anchorColorRow.input.text);
            var handleColor = hexToRgbArray(handleColorRow.input.text);
            var lineColor   = hexToRgbArray(lineColorRow.input.text);

            if(!anchorColor || !handleColor || !lineColor){
                alert("Please enter HEX colors in the #FFFFFF format.");
                return;
            }

            var opts = {
                anchorSize: anchorSize,
                anchorColor: anchorColor,
                handleSize: handleSize,
                handleColor: handleColor,
                lineColor: lineColor,
                lineWidth: lineWidth,
                hideZeroHandles: hideZeroChk.value,
                showHandles: showHandlesChk.value,
                showLines: showLinesChk.value,
                anchorShape: anchorShapeDropdown.selection.text,
                handleShape: handleShapeDropdown.selection.text
            };

            app.beginUndoGroup("Anchor + Bezier Overlay Controller");

            if(createRadio.value){
                if(comp.selectedLayers.length === 0){
                    alert("Please select one or more Shape Layers.");
                    app.endUndoGroup();
                    return;
                }

                var validLayers = [];
                for(var i=0;i<comp.selectedLayers.length;i++){
                    var layer = comp.selectedLayers[i];
                    if(isShapeLayer(layer) && !isOverlayLayer(layer)){
                        validLayers.push(layer);
                    }
                }

                if(validLayers.length === 0){
                    alert("No valid Shape Layers were found in the current selection.");
                    app.endUndoGroup();
                    return;
                }

                if(validLayers.length === 1){
                    var singleOverlay = createOverlayForLayer(validLayers[0], opts);
                    singleOverlay.moveToBeginning();
                    hideAllOtherShapeLayers(comp, validLayers[0], singleOverlay);
                    alert("Overlay created successfully.");
                }
                else {
                    var morphResult = createChainedMorphOnLayers(validLayers, morphDuration);
                    var overlay = createOverlayForLayer(validLayers[0], opts);
                    overlay.moveToBeginning();

                    hideAllOtherShapeLayers(comp, validLayers[0], overlay);

                    var msg = [];
                    msg.push("Auto Morph + Overlay completed.");
                    msg.push("");
                    msg.push("Target Layer: " + validLayers[0].name);
                    msg.push("Selected Layers: " + validLayers.length);
                    msg.push("Segments: " + (validLayers.length - 1));
                    msg.push("Total Matched Paths: " + morphResult.totalMatched);

                    if (morphResult.segments.length > 0){
                        msg.push("");
                        msg.push("[Segment Summary]");
                        for (var si = 0; si < morphResult.segments.length; si++){
                            msg.push(
                                "- " +
                                morphResult.segments[si].fromLayer +
                                " -> " +
                                morphResult.segments[si].toLayer +
                                " : " +
                                morphResult.segments[si].matched +
                                " matched"
                            );
                        }
                    }

                    if (morphResult.totalMissing.length > 0){
                        msg.push("");
                        msg.push("[Skipped: Matching path name not found]");
                        for (var m=0; m<morphResult.totalMissing.length; m++){
                            msg.push("- " + morphResult.totalMissing[m]);
                        }
                    }

                    if (morphResult.totalSkipped.length > 0){
                        msg.push("");
                        msg.push("[Skipped: Incompatible or failed]");
                        for (var s=0; s<morphResult.totalSkipped.length; s++){
                            msg.push("- " + morphResult.totalSkipped[s]);
                        }
                    }

                    alert(msg.join("\n"));
                }
            } else {
                if(comp.selectedLayers.length === 0){
                    alert("Please select overlay layers to update.");
                    app.endUndoGroup();
                    return;
                }

                var updated = 0;
                for(var j=0;j<comp.selectedLayers.length;j++){
                    var overlayLayer = comp.selectedLayers[j];
                    if(isOverlayLayer(overlayLayer)){
                        updateOverlayLayer(overlayLayer, opts);
                        updated++;
                    }
                }

                if (updated === 0){
                    alert("No updatable overlay layers were found in the current selection.");
                    app.endUndoGroup();
                    return;
                }
            }

            app.endUndoGroup();
        };

        win.layout.layout(true);
        win.onResizing = win.onResize = function(){
            this.layout.resize();
        };

        return win;
    }

    var ui = buildUI(thisObj);
    if(ui instanceof Window){
        ui.center();
        ui.show();
    }

})(this);