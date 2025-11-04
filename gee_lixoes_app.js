/**
 * =====================================================
 * APLICATIVO GOOGLE EARTH ENGINE
 * Análise de Probabilidade de Lixões
 * =====================================================
 *
 * DESCRIÇÃO:
 * Sistema interativo de visualização e análise espacial para
 * identificação de áreas com probabilidade de lixões utilizando
 * dados raster e vetoriais processados no Google Earth Engine.
 *
 * FUNCIONALIDADES:
 * - Base map híbrido (satélite + nomes) para melhor contexto
 * - Visualização com paleta otimizada (azul escuro → vermelho)
 * - Destaque visual para polígonos de alta probabilidade
 * - Filtros espaciais por estado e município
 * - Busca interativa de municípios
 * - Métricas agregadas e distribuição por faixa
 * - Popup informativo ao clicar em polígonos
 * - Interface otimizada para renderização
 *
 * VERSÃO: 2.0 - Otimizada e Melhorada
 * DESENVOLVIDO COM: Google Earth Engine Code Editor
 * =====================================================
 */

// ===========================
// CONFIGURAÇÕES E CONSTANTES
// ===========================

var CONFIG = {
  // Assets
  rasterFolder: 'projects/ee-lixoes/assets/FINAL_RESULTS_BIN',
  vectorAsset: 'projects/lixoes-467518/assets/resultsVect/MEDIAN_IMPROVED_THRESHOLDS_70_MIN_AREAS_1000_SCIKIT_ALL_METRICS_V6',
  
  // Visualização
  probabilityPalette: ['#050220', '#0f567f', '#1e90ff', '#6dc07a', '#efff36', '#FF0000'],
  mapCenter: {lon: -47.93, lat: -15.78}, // Centro do Brasil
  mapZoom: 4,
  
  // Faixas de probabilidade
  probabilityRanges: {
    baixa: [0, 0.72],
    media: [0.72, 0.81],
    alta: [0.81, 1.0]
  }
};

// ===========================
// CARREGAMENTO DE DADOS
// ===========================

/**
 * Carrega e processa os dados raster
 */
function loadRasterData() {
  var assetList = ee.data.listAssets(CONFIG.rasterFolder);
  
  function loadImages(assetList) {
    return assetList.assets.map(function(asset) {
      return ee.Image(asset.name);
    });
  }
  
  var imageCollection = ee.ImageCollection(loadImages(assetList));
  var mosaic = imageCollection.mosaic();
  
  // Garantir valores entre 0 e 1
  mosaic = mosaic.clamp(0, 1);
  
  return mosaic;
}

/**
 * Carrega dados vetoriais
 */
function loadVectorData() {
  return ee.FeatureCollection(CONFIG.vectorAsset);
}

// ===========================
// PROCESSAMENTO DE DADOS
// ===========================

/**
 * Detecta quais colunas de probabilidade existem no vetor
 */
function detectProbabilityColumns(vectorData) {
  var first = ee.Feature(vectorData.first());
  var properties = first.propertyNames();
  
  var possibleColumns = ['prob_media', 'prob_mean', 'prob_max'];
  var availableColumns = [];
  
  possibleColumns.forEach(function(col) {
    if (properties.contains(col).getInfo()) {
      availableColumns.push(col);
    }
  });
  
  return availableColumns;
}

/**
 * Obtém lista única de estados
 */
function getUniqueStates(vectorData) {
  var states = vectorData.aggregate_array('uf').distinct();
  return states.sort().getInfo();
}

/**
 * Obtém municípios de um estado
 */
function getMunicipalities(vectorData, state) {
  var filtered = vectorData.filter(ee.Filter.eq('uf', state));
  var municipalities = filtered.aggregate_array('muni_name').distinct();
  return municipalities.sort().getInfo();
}

/**
 * Calcula estatísticas por faixa de probabilidade
 */
function calculateStatsByRange(features, probColumn) {
  var ranges = CONFIG.probabilityRanges;
  var stats = {};
  
  Object.keys(ranges).forEach(function(range) {
    var min = ranges[range][0];
    var max = ranges[range][1];
    
    var count = features.filter(
      ee.Filter.and(
        ee.Filter.gte(probColumn, min),
        ee.Filter.lt(probColumn, max)
      )
    ).size();
    
    stats[range] = count.getInfo();
  });
  
  return stats;
}

/**
 * Calcula estatísticas por UF
 */
function calculateStatsByState(vectorData, probColumn) {
  var states = getUniqueStates(vectorData);
  var stats = {};
  
  states.forEach(function(state) {
    var stateFeatures = vectorData.filter(ee.Filter.eq('uf', state));
    var count = stateFeatures.size().getInfo();
    var avgProb = stateFeatures.aggregate_mean(probColumn).getInfo();
    
    stats[state] = {
      count: count,
      avgProbability: avgProb
    };
  });
  
  return stats;
}

// ===========================
// ESTILIZAÇÃO
// ===========================

/**
 * Estilo para features vetoriais por probabilidade
 * Usa as faixas definidas em CONFIG.probabilityRanges
 * Polígonos de alta probabilidade recebem destaque visual
 */
function getFeatureStyle(feature, probColumn) {
  var prob = ee.Number(feature.get(probColumn));

  // Paleta de cores baseada nas faixas de probabilidade
  // Baixa (0-0.75): Verde - #4CAF50
  // Média (0.75-0.89): Laranja - #FF9800
  // Alta (0.89-1.0): Vermelho - #F44336
  var color = ee.Algorithms.If(
    prob.lt(0.75), '#4CAF50',
    ee.Algorithms.If(
      prob.lt(0.89), '#FF9800',
      '#F44336'
    )
  );

  // Destaque para polígonos de alta probabilidade
  // Alta probabilidade: borda mais grossa (3px) e opacidade máxima (0.95)
  // Média probabilidade: borda média (2px) e opacidade alta (0.85)
  // Baixa probabilidade: borda fina (1.5px) e opacidade média (0.65)
  var borderWidth = ee.Algorithms.If(
    prob.lt(0.75), 1.5,
    ee.Algorithms.If(
      prob.lt(0.89), 2,
      3
    )
  );

  var fillOpacity = ee.Algorithms.If(
    prob.lt(0.75), 0.65,
    ee.Algorithms.If(
      prob.lt(0.89), 0.85,
      0.95
    )
  );

  return feature.set({
    style: {
      color: '#000000',      // Borda preta para maior contraste
      fillColor: color,
      width: borderWidth,
      fillOpacity: fillOpacity
    }
  });
}

/**
 * Aplica estilo ao vetor
 */
function styleVector(vectorData, probColumn) {
  return vectorData.map(function(feature) {
    return getFeatureStyle(feature, probColumn);
  });
}

// ===========================
// INTERFACE DO USUÁRIO
// ===========================

// Elementos principais
var mainPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {width: '100%', height: '100%'}
});

mainPanel.style().set('stretch', 'both');

var sidePanel = ui.Panel({
  style: {
    width: '430px',
    padding: '16px',
    backgroundColor: '#ecf0f1'
  }
});

sidePanel.style().set('stretch', 'vertical');

var mapPanel = ui.Map();
mapPanel.setCenter(CONFIG.mapCenter.lon, CONFIG.mapCenter.lat, CONFIG.mapZoom);
mapPanel.setOptions('hybrid'); // Base map híbrido (satélite + nomes)
mapPanel.style().set('cursor', 'crosshair');
mapPanel.style().set('stretch', 'both');

// ===========================
// CONSTRUÇÃO DA UI
// ===========================

/**
 * Cria cabeçalho do aplicativo com título destacado
 */
function createAppHeader() {
  var header = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      width: '100%',
      padding: '20px 28px',
      backgroundColor: '#0b1f33',
      borderBottom: '3px solid #176087'
    }
  });

  var titleColumn = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      stretch: 'horizontal'
    }
  });

  var title = ui.Label({
    value: 'ANÁLISE DE PROBABILIDADE DE LIXÕES',
    style: {
      fontSize: '20px',
      fontWeight: 'bold',
      color: '#ffffff',
      letterSpacing: '1px',
      textTransform: 'uppercase',
      margin: '0'
    }
  });

  var subtitle = ui.Label({
    value: 'Monitoramento ambiental com Google Earth Engine',
    style: {
      fontSize: '12px',
      color: '#d0e6f4',
      margin: '6px 0 0 0',
      fontStyle: 'italic'
    }
  });

  titleColumn.add(title);
  titleColumn.add(subtitle);

  header.add(titleColumn);

  return header;
}

/**
 * Cria seção de filtros
 * Otimizada para melhor usabilidade e estética
 */
function createFilterSection(vectorData, probColumns) {
  var filterPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid #e0e0e0',
      borderRadius: '4px'
    }
  });

  filterPanel.add(ui.Label('FILTROS ESPACIAIS', {
    fontWeight: 'bold',
    fontSize: '15px',
    color: '#1a252f',
    margin: '0 0 14px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  }));

  // Filtro de estado
  var stateLabel = ui.Label('Estado (UF):', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '8px 0 5px 0',
    fontWeight: '600'
  });
  var states = ['Todos'].concat(getUniqueStates(vectorData));
  var stateSelect = ui.Select({
    items: states,
    value: 'Todos',
    style: {
      width: '100%',
      margin: '0 0 12px 0',
      padding: '6px'
    }
  });

  // Filtro de município
  var muniLabel = ui.Label('Município:', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '8px 0 5px 0',
    fontWeight: '600'
  });
  var muniSelect = ui.Select({
    items: ['Todos'],
    value: 'Todos',
    style: {
      width: '100%',
      margin: '0 0 12px 0',
      padding: '6px'
    },
    disabled: true
  });

  // Campo de busca de município
  var muniSearchLabel = ui.Label('Buscar município:', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '8px 0 5px 0',
    fontWeight: '600'
  });
  var muniSearchBox = ui.Textbox({
    placeholder: 'Digite o nome do município...',
    style: {
      width: '100%',
      margin: '0 0 12px 0',
      padding: '6px'
    },
    disabled: true
  });
  
  // Atualizar municípios quando estado mudar
  stateSelect.onChange(function(state) {
    if (state === 'Todos') {
      muniSelect.items().reset(['Todos']);
      muniSelect.setDisabled(true);
      muniSearchBox.setDisabled(true);
    } else {
      var municipalities = ['Todos'].concat(getMunicipalities(vectorData, state));
      muniSelect.items().reset(municipalities);
      muniSelect.setDisabled(false);
      muniSearchBox.setDisabled(false);
    }
    muniSelect.setValue('Todos');
    updateVisualization();
  });
  
  // Busca de município
  muniSearchBox.onChange(function(text) {
    if (text && stateSelect.getValue() !== 'Todos') {
      var state = stateSelect.getValue();
      var allMunis = getMunicipalities(vectorData, state);
      var filtered = allMunis.filter(function(muni) {
        return muni.toLowerCase().indexOf(text.toLowerCase()) !== -1;
      });
      muniSelect.items().reset(['Todos'].concat(filtered));
    }
  });

  filterPanel.add(stateLabel);
  filterPanel.add(stateSelect);
  filterPanel.add(muniLabel);
  filterPanel.add(muniSelect);
  filterPanel.add(muniSearchLabel);
  filterPanel.add(muniSearchBox);
  
  // Botão aplicar filtros - otimizado para renderização
  var applyButton = ui.Button({
    label: 'APLICAR FILTROS',
    style: {
      width: '100%',
      margin: '15px 0 5px 0',
      backgroundColor: '#2980b9',
      color: '#FFFFFF',
      padding: '12px 16px',
      fontSize: '14px',
      fontWeight: 'bold',
      textAlign: 'center',
      border: '2px solid #1a5490',
      borderRadius: '4px'
    },
    onClick: updateVisualization
  });

  filterPanel.add(applyButton);

  // Separador visual
  var separator = ui.Panel({
    style: {
      height: '1px',
      backgroundColor: '#bdc3c7',
      margin: '15px 0'
    }
  });
  filterPanel.add(separator);

  // Controle de opacidade do raster
  var opacityLabel = ui.Label('Opacidade da camada raster:', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '8px 0 5px 0',
    fontWeight: '600'
  });

  var opacitySlider = ui.Slider({
    min: 0,
    max: 1,
    value: 0.65,
    step: 0.05,
    style: {
      width: '100%',
      margin: '0 0 8px 0'
    }
  });

  var opacityValueLabel = ui.Label('65%', {
    fontSize: '11px',
    color: '#7f8c8d',
    margin: '0 0 12px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  });

  opacitySlider.onChange(function(value) {
    opacityValueLabel.setValue((value * 100).toFixed(0) + '%');
    updateVisualization();
  });

  filterPanel.add(opacityLabel);
  filterPanel.add(opacitySlider);
  filterPanel.add(opacityValueLabel);

  // Checkboxes para controle de camadas
  var layersLabel = ui.Label('Visibilidade das camadas:', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '15px 0 5px 0',
    fontWeight: '600'
  });
  filterPanel.add(layersLabel);

  var rasterCheckbox = ui.Checkbox({
    label: 'Exibir camada raster',
    value: true,
    style: {
      margin: '5px 0',
      fontSize: '12px'
    }
  });

  var vectorCheckbox = ui.Checkbox({
    label: 'Exibir polígonos',
    value: true,
    style: {
      margin: '5px 0 12px 0',
      fontSize: '12px'
    }
  });

  rasterCheckbox.onChange(updateVisualization);
  vectorCheckbox.onChange(updateVisualization);

  filterPanel.add(rasterCheckbox);
  filterPanel.add(vectorCheckbox);

  // Botão de reset
  var resetButton = ui.Button({
    label: 'RESETAR VISUALIZAÇÃO',
    style: {
      width: '100%',
      margin: '8px 0 0 0',
      backgroundColor: '#95a5a6',
      color: '#FFFFFF',
      padding: '10px 16px',
      fontSize: '13px',
      fontWeight: 'bold',
      textAlign: 'center'
    },
    onClick: function() {
      stateSelect.setValue('Todos');
      muniSelect.setValue('Todos');
      opacitySlider.setValue(0.65);
      rasterCheckbox.setValue(true);
      vectorCheckbox.setValue(true);
      mapPanel.setCenter(CONFIG.mapCenter.lon, CONFIG.mapCenter.lat, CONFIG.mapZoom);
      updateVisualization();
    }
  });

  filterPanel.add(resetButton);

  return {
    panel: filterPanel,
    stateSelect: stateSelect,
    muniSelect: muniSelect,
    opacitySlider: opacitySlider,
    rasterCheckbox: rasterCheckbox,
    vectorCheckbox: vectorCheckbox
  };
}

/**
 * Cria painel de métricas
 * Otimizado para melhor visualização e organização
 */
function createMetricsPanel() {
  var metricsPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid #e0e0e0',
      borderRadius: '4px'
    }
  });

  metricsPanel.add(ui.Label('MÉTRICAS E ESTATÍSTICAS', {
    fontWeight: 'bold',
    fontSize: '15px',
    color: '#1a252f',
    margin: '0 0 14px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  }));

  // Placeholders para métricas principais
  var totalLabel = ui.Label('Total de ocorrências: -', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '6px 0',
    fontWeight: '600'
  });
  var avgProbLabel = ui.Label('Probabilidade média: -', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '6px 0 14px 0',
    fontWeight: '600'
  });

  // Painel de distribuição por faixa
  var rangePanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      margin: '14px 0 0 0',
      padding: '14px',
      backgroundColor: '#f8f9fa',
      border: '2px solid #dee2e6',
      borderRadius: '4px'
    }
  });

  rangePanel.add(ui.Label('DISTRIBUIÇÃO POR FAIXA', {
    fontWeight: 'bold',
    fontSize: '12px',
    color: '#1a252f',
    margin: '0 0 10px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  }));

  var lowLabel = ui.Label('Baixa (0-75%): -', {
    fontSize: '12px',
    color: '#2e7d32',
    margin: '5px 0',
    fontWeight: '600'
  });
  var medLabel = ui.Label('Média (75-89%): -', {
    fontSize: '12px',
    color: '#e65100',
    margin: '5px 0',
    fontWeight: '600'
  });
  var highLabel = ui.Label('Alta (89-100%): -', {
    fontSize: '12px',
    color: '#c62828',
    margin: '5px 0',
    fontWeight: '600'
  });

  rangePanel.add(lowLabel);
  rangePanel.add(medLabel);
  rangePanel.add(highLabel);

  metricsPanel.add(totalLabel);
  metricsPanel.add(avgProbLabel);
  metricsPanel.add(rangePanel);

  return {
    panel: metricsPanel,
    totalLabel: totalLabel,
    avgProbLabel: avgProbLabel,
    lowLabel: lowLabel,
    medLabel: medLabel,
    highLabel: highLabel
  };
}

/**
 * Cria título para o header do mapa
 */
function createMapTitle() {
  var titlePanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      position: 'top-center',
      backgroundColor: 'rgba(11, 31, 51, 0.92)',
      padding: '14px 32px',
      margin: '0',
      border: '2px solid #176087',
      borderRadius: '0 0 10px 10px'
    }
  });

var title = ui.Label('ANÁLISE DE LIXÕES', {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#ffffff',
  letterSpacing: '1px',
  textAlign: 'center',
  whiteSpace: 'pre',
  margin: '0',
  padding: '0px',
  border: '0',
  backgroundColor: 'rgba(0,0,0,0)', // <- transparência
  stretch: 'horizontal'              // ajuda o alinhamento central
});

var subtitle = ui.Label('Mapeamento', {
  fontSize: '11px',
  color: '#d0e6f4',
  backgroundColor: 'rgba(0,0,0,0)',   // transparente
  border: '0',                         // sem borda
  padding: '0px',
  margin: '2px 0 0 0',
  textAlign: 'center',
  stretch: 'horizontal'                // para o textAlign funcionar melhor
});

  titlePanel.add(title);
  titlePanel.add(subtitle);

  return titlePanel;
}

/**
 * Adiciona logos de apoiadores no footer do painel lateral
 * Otimizado para renderização adequada
 */
function createFooterWithLogos() {
  var footerPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '15px 0 0 0',
      border: '1px solid #e0e0e0',
      borderRadius: '4px'
    }
  });

  footerPanel.add(ui.Label('APOIO E PARCEIROS', {
    fontWeight: 'bold',
    fontSize: '14px',
    color: '#2c3e50',
    margin: '0 0 12px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  }));

  // Texto de apoiadores (pode ser customizado)
  var apoiadoresText = ui.Label(
    'Instituições de Pesquisa\n' +
    'Google Earth Engine\n' +
    'Laboratórios Parceiros\n' +
    'Dados Abertos Brasil',
    {
      fontSize: '11px',
      color: '#555',
      margin: '0',
      whiteSpace: 'pre',
      textAlign: 'center',
      stretch: 'horizontal'
    }
  );

  footerPanel.add(apoiadoresText);

  // Informação de versão/créditos
  var credits = ui.Label('Desenvolvido com Google Earth Engine • v2.0', {
    fontSize: '10px',
    color: '#95a5a6',
    margin: '12px 0 0 0',
    fontStyle: 'italic',
    textAlign: 'center',
    stretch: 'horizontal'
  });

  footerPanel.add(credits);

  return footerPanel;
}

// ===========================
// ATUALIZAÇÃO E VISUALIZAÇÃO
// ===========================

/**
 * Atualiza visualização com base nos filtros
 */
function updateVisualization() {
  // Limpar camadas anteriores (mantém widgets do mapa)
  var layers = mapPanel.layers();
  while (layers.length() > 0) {
    layers.remove(layers.get(0));
  }

  // Usar métrica de probabilidade padrão (primeira disponível)
  var metric = probColumns[0];
  var state = filters.stateSelect.getValue();
  var muni = filters.muniSelect.getValue();
  
  // Filtrar dados vetoriais
  var filteredVector = vectorData;
  
  if (state !== 'Todos') {
    filteredVector = filteredVector.filter(ee.Filter.eq('uf', state));
  }
  
  if (muni !== 'Todos' && muni !== null) {
    filteredVector = filteredVector.filter(ee.Filter.eq('muni_name', muni));
  }
  
  // Aplicar estilo
  var styledVector = styleVector(filteredVector, metric);
  
  // Adicionar camadas ao mapa
  // Raster com opacidade otimizada para melhor visualização sobre satélite
  var opacity = filters.opacitySlider ? filters.opacitySlider.getValue() : 0.65;
  var showRaster = filters.rasterCheckbox ? filters.rasterCheckbox.getValue() : true;
  var showVector = filters.vectorCheckbox ? filters.vectorCheckbox.getValue() : true;

  if (showRaster) {
    mapPanel.addLayer(rasterData.select('prob_class0'), {
      min: 0,
      max: 1,
      palette: CONFIG.probabilityPalette
    }, 'Probabilidade (Raster)', true, opacity);
  }

  // Vetor com estilo otimizado
  if (showVector) {
    mapPanel.addLayer(styledVector.style({styleProperty: 'style'}), {}, 'Polígonos Detectados');
  }

  // Centralizar no filtro se específico
  if (muni !== 'Todos' && muni !== null) {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 12);
  } else if (state !== 'Todos') {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 7);
  }
  
  // Atualizar métricas
  updateMetrics(filteredVector, metric);
  
  // Configurar clique para popup
  mapPanel.onClick(function(coords) {
    var point = ee.Geometry.Point(coords.lon, coords.lat);
    var clicked = styledVector.filterBounds(point);

    clicked.evaluate(function(features) {
      if (features.features.length > 0) {
        var feat = features.features[0];
        var props = feat.properties;

        var prob = props[metric] * 100;
        var probText = prob.toFixed(1).replace('.', ',') + '%';

        // Determinar a faixa de probabilidade
        var faixa = '';
        if (prob < 75) {
          faixa = 'Baixa';
        } else if (prob < 89) {
          faixa = 'Média';
        } else {
          faixa = 'Alta';
        }

        var infoPanel = ui.Panel({
          widgets: [
            ui.Label('INFORMAÇÕES DA ÁREA', {
              fontWeight: 'bold',
              fontSize: '13px',
              color: '#1a252f',
              margin: '0 0 10px 0',
              backgroundColor: '#ecf0f1',
              padding: '6px',
              textAlign: 'center',
              stretch: 'horizontal'
            }),
            ui.Label('Estado: ' + props.uf, {
              fontSize: '12px',
              color: '#2c3e50',
              margin: '4px 0',
              fontWeight: '600'
            }),
            ui.Label('Município: ' + props.muni_name, {
              fontSize: '12px',
              color: '#2c3e50',
              margin: '4px 0',
              fontWeight: '600'
            }),
            ui.Label('Probabilidade: ' + probText, {
              fontSize: '13px',
              color: prob >= 89 ? '#c62828' : (prob >= 75 ? '#ef6c00' : '#2e7d32'),
              fontWeight: 'bold',
              margin: '8px 0 4px 0'
            }),
            ui.Label('Classificação: ' + faixa.toUpperCase(), {
              fontSize: '11px',
              color: '#7f8c8d',
              fontStyle: 'italic',
              margin: '0'
            })
          ],
          style: {
            position: 'bottom-left',
            backgroundColor: 'rgba(255, 255, 255, 0.97)',
            padding: '16px 18px',
            border: '3px solid #2c3e50',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: '280px'
          }
        });

        mapPanel.add(infoPanel);
      }
    });
  });
}

/**
 * Atualiza painel de métricas
 * Calcula e exibe estatísticas sobre os polígonos filtrados
 */
function updateMetrics(features, probColumn) {
  var count = features.size();
  var avgProb = features.aggregate_mean(probColumn);

  // Atualizar labels básicos com formatação aprimorada
  var totalOcorrencias = count.getInfo();
  metrics.totalLabel.setValue('Total de ocorrências: ' + totalOcorrencias);

  var avgProbValue = (avgProb.getInfo() * 100).toFixed(1).replace('.', ',');
  metrics.avgProbLabel.setValue('Probabilidade média: ' + avgProbValue + '%');

  // Calcular e exibir distribuição por faixa de probabilidade
  var rangeStats = calculateStatsByRange(features, probColumn);
  metrics.lowLabel.setValue('Baixa: ' + rangeStats.baixa + ' áreas');
  metrics.medLabel.setValue('Média: ' + rangeStats.media + ' áreas');
  metrics.highLabel.setValue('Alta: ' + rangeStats.alta + ' áreas');
}

// ===========================
// INICIALIZAÇÃO
// ===========================

// Carregar dados
print('Carregando dados...');
var rasterData = loadRasterData();
var vectorData = loadVectorData();

// Detectar colunas disponíveis
var probColumns = detectProbabilityColumns(vectorData);

if (probColumns.length === 0) {
  print('ERRO: Nenhuma coluna de probabilidade encontrada (prob_media, prob_mean, prob_max)');
  print('Verifique os dados vetoriais');
} else {
  print('Colunas de probabilidade disponíveis:', probColumns);
  
  // Construir interface
  var filterSection = createFilterSection(vectorData, probColumns);
  var filters = filterSection;
  sidePanel.add(filterSection.panel);

  var metricsSection = createMetricsPanel();
  var metrics = metricsSection;
  sidePanel.add(metricsSection.panel);

  // Adicionar footer com logos dos apoiadores
  sidePanel.add(createFooterWithLogos());

  // Adicionar título ao mapa apenas uma vez
  mapPanel.add(createMapTitle());

  // Montar layout principal
  mainPanel.add(sidePanel);
  mainPanel.add(mapPanel);

  var appLayout = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      width: '100%',
      height: '100%',
      padding: '0'
    }
  });

  appLayout.style().set('stretch', 'both');

  appLayout.add(createAppHeader());
  appLayout.add(mainPanel);

  // Limpar root e adicionar painel principal
  ui.root.clear();
  ui.root.add(appLayout);

  // Carregar visualização inicial
  updateVisualization();
}
