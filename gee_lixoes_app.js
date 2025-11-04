// ===========================
// CONFIGURAÇÕES E CONSTANTES
// ===========================

var CONFIG = {
  // Assets
  rasterFolder: 'projects/ee-lixoes/assets/FINAL_RESULTS_BIN',
  vectorCollection: 'projects/ee-lixoes/assets/RESULTADOS_VECT/METHOD2_IMPROVED_THRESHOLDS_73_MIN_AREAS_1500',
  vectorFeatureView: 'projects/ee-lixoes/assets/RESULTADOS_VECT/METHOD2_IMPROVED_THRESHOLDS_73_MIN_AREAS_1500_FV',
  validatedCollection: 'projects/ee-lixoes/assets/Polygons/PolygonsDumpValid',
  validatedFeatureView: 'projects/ee-lixoes/assets/Polygons/PolygonsDumpValid_FV',
  
  // Visualização
  probabilityPalette: ['#050220', '#0f567f', '#1e90ff', '#6dc07a', '#efff36', '#FF0000'],
  mapCenter: {lon: -47.93, lat: -15.78}, // Centro do Brasil
  mapZoom: 4,
  
  // Faixas de probabilidade
  probabilityRanges: {
    baixa: [0, 0.76],
    media: [0.76, 0.832],
    alta: [0.832, 1.0]
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
  return ee.FeatureCollection(CONFIG.vectorCollection);
}

/**
 * Carrega dados vetoriais de lixões validados
 */
function loadValidatedVectorData() {
  return ee.FeatureCollection(CONFIG.validatedCollection);
}

// ===========================
// PROCESSAMENTO DE DADOS
// ===========================

/**
 * Detecta quais colunas de probabilidade existem no vetor
 * Prioriza 'prob_median' como coluna padrão de referência
 */
function detectProbabilityColumns(vectorData) {
  var first = ee.Feature(vectorData.first());
  var properties = first.propertyNames();

  // Lista ordenada por prioridade: prob_median é a coluna padrão preferida
  var possibleColumns = ['prob_median', 'prob_media', 'prob_mean', 'prob_max'];
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
 * Cria estilo dinâmico para FeatureView com base na métrica selecionada
 */
function createFeatureViewStyle(metric) {
  return {
    color: '#4CAF50',
    fillColor: '#4CAF50',
    width: 1.5,
    fillOpacity: 0.65,
    rules: [
      {
        filter: ee.Filter.lt(metric, 0.75),
        color: '#4CAF50',
        fillColor: '#4CAF50',
        width: 1.5,
        fillOpacity: 0.65
      },
      {
        filter: ee.Filter.and(
          ee.Filter.gte(metric, 0.75),
          ee.Filter.lt(metric, 0.89)
        ),
        color: '#FF9800',
        fillColor: '#FF9800',
        width: 2,
        fillOpacity: 0.85
      },
      {
        filter: ee.Filter.gte(metric, 0.89),
        color: '#F44336',
        fillColor: '#F44336',
        width: 3,
        fillOpacity: 0.95
      }
    ]
  };
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
    backgroundColor: 'rgba(0,0,0,0)'
  }
});

sidePanel.style().set('stretch', 'vertical');

var mapPanel = ui.Map();
mapPanel.setCenter(CONFIG.mapCenter.lon, CONFIG.mapCenter.lat, CONFIG.mapZoom);
mapPanel.setOptions('hybrid'); // Base map híbrido (satélite + nomes)
mapPanel.style().set('cursor', 'crosshair');
mapPanel.style().set('stretch', 'both');

// Referências globais para atualização dinâmica
var headerSummary = null;
var metrics = null;
var filters = null;

// ===========================
// CONSTRUÇÃO DA UI
// ===========================

/**
 * Cria cabeçalho do aplicativo com título e cartões de resumo
 */
function createAppHeader() {
  var header = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      width: '100%',
      padding: '16px 26px 18px 26px',
      backgroundColor: '#0b1f33'
    }
  });

  var topRow = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      stretch: 'horizontal',
      margin: '0 0 16px 0',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  var titleColumn = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      stretch: 'horizontal',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  var title = ui.Label({
    value: 'ANÁLISE DE PROBABILIDADE DE LIXÕES',
    style: {
      fontSize: '21px',
      fontWeight: 'bold',
      color: '#ffffff',
      margin: '0',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  var subtitle = ui.Label({
    value: 'Monitoramento ambiental com Google Earth Engine',
    style: {
      fontSize: '12px',
      color: '#d0e6f4',
      margin: '4px 0 0 0',
      fontStyle: 'italic',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  var filterContextLabel = ui.Label({
    value: 'Visão geral nacional',
    style: {
      fontSize: '11px',
      color: '#9ac0d8',
      margin: '8px 0 0 0',
      fontStyle: 'italic',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  titleColumn.add(title);
  titleColumn.add(subtitle);
  titleColumn.add(filterContextLabel);

  topRow.add(titleColumn);

  header.add(topRow);

  var summaryRow = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      stretch: 'horizontal',
      backgroundColor: 'rgba(0,0,0,0)'
    }
  });

  function createSummaryCard(titleText, accentColor) {
    var card = ui.Panel({
      layout: ui.Panel.Layout.flow('vertical'),
      style: {
        backgroundColor: 'rgba(9, 25, 42, 0.85)',
        border: '1px solid ' + accentColor,
        borderRadius: '6px',
        padding: '10px 14px',
        margin: '0 10px 0 0',
        minWidth: '130px'
      }
    });

    var label = ui.Label({
      value: titleText,
      style: {
        color: '#cfe8f5',
        fontSize: '10px',
        margin: '0 0 4px 0',
        backgroundColor: 'rgba(0,0,0,0)'
      }
    });

    var valueLabel = ui.Label({
      value: '-',
      style: {
        fontSize: '18px',
        fontWeight: 'bold',
        color: accentColor,
        margin: '0',
        backgroundColor: 'rgba(0,0,0,0)'
      }
    });

    card.add(label);
    card.add(valueLabel);

    return {card: card, valueLabel: valueLabel};
  }

  var totalSummary = createSummaryCard('Ocorrências monitoradas', '#4fc3f7');
  // var avgSummary = createSummaryCard('Probabilidade média', '#81c784');
  var highSummary = createSummaryCard('Áreas de alta probabilidade', '#ff8a65');
  var validatedSummary = createSummaryCard('Lixões validados', '#f1c40f');

  summaryRow.add(totalSummary.card);
  // summaryRow.add(avgSummary.card);
  summaryRow.add(highSummary.card);
  summaryRow.add(validatedSummary.card);
  validatedSummary.card.style().set('margin', '0');

  header.add(summaryRow);

  return {
    panel: header,
    filterLabel: filterContextLabel,
    totalSummaryLabel: totalSummary.valueLabel,
    // avgSummaryLabel: avgSummary.valueLabel,
    highSummaryLabel: highSummary.valueLabel,
    validatedSummaryLabel: validatedSummary.valueLabel
  };
}

/**
 * Cria seção de filtros
 * Otimizada para melhor usabilidade e estética
 */
function createFilterSection(vectorData, probColumns) {
  var filterPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: 'rgba(0,0,0,0)',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '4px'
    }
  });

  filterPanel.add(ui.Label('FILTROS ESPACIAIS', {
    fontWeight: 'bold',
    fontSize: '15px',
    color: '#1a252f',
    margin: '0 0 14px 0',
    textAlign: 'center',
    stretch: 'horizontal',
    backgroundColor: 'rgba(0,0,0,0)'
  }));

  // Filtro de estado
  var stateLabel = ui.Label('Estado (UF):', {
    fontSize: '13px',
    color: '#2c3e50',
    margin: '8px 0 5px 0',
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0)'
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
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0)'
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

  // Atualizar municípios quando estado mudar
  stateSelect.onChange(function(state) {
    if (state === 'Todos') {
      muniSelect.items().reset(['Todos']);
      muniSelect.setDisabled(true);
    } else {
      var municipalities = ['Todos'].concat(getMunicipalities(vectorData, state));
      muniSelect.items().reset(municipalities);
      muniSelect.setDisabled(false);
    }
    muniSelect.setValue('Todos');
    updateVisualization();
  });

  filterPanel.add(stateLabel);
  filterPanel.add(stateSelect);
  filterPanel.add(muniLabel);
  filterPanel.add(muniSelect);
  
  // Botão aplicar filtros - otimizado para renderização
  var applyButton = ui.Button({
    label: 'APLICAR FILTROS',
    style: {
      width: '100%',
      margin: '15px 0 5px 0',
      backgroundColor: '#2980b9',
      color: '#403e3e',
      padding: '12px 16px',
      fontSize: '14px',
      fontWeight: 'bold',
      textAlign: 'center',
      border: '2px solid #1a5490',
      borderRadius: '4px',
      backgroundColor: 'rgba(0,0,0,0)'
    },
    onClick: updateVisualization
  });

  filterPanel.add(applyButton);

  // Separador visual
  var separator = ui.Panel({
    style: {
      height: '1px',
      backgroundColor: 'rgba(0,0,0,0)',
      margin: '15px 0'
    }
  });
  filterPanel.add(separator);

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
      color: '#403e3e',
      padding: '10px 16px',
      fontSize: '13px',
      fontWeight: 'bold',
      textAlign: 'center',
      border: '2px solid #7f8c8d',
      backgroundColor: 'rgba(0,0,0,0)'
    },
    onClick: function() {
      stateSelect.setValue('Todos');
      muniSelect.setValue('Todos');
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
      backgroundColor: 'rgba(0,0,0,0)',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid rgba(255,255,255,0.12)',
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

  var validatedLabel = ui.Label('Lixões validados: -', {
    fontSize: '13px',
    color: '#b9770e',
    margin: '6px 0 14px 0',
    fontWeight: '600'
  });

  // Painel de distribuição por faixa
  var rangePanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      margin: '14px 0 0 0',
      padding: '14px',
      backgroundColor: 'rgba(0,0,0,0)',
      border: '1px solid rgba(255,255,255,0.12)',
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
  metricsPanel.add(validatedLabel);
  metricsPanel.add(rangePanel);

  return {
    panel: metricsPanel,
    totalLabel: totalLabel,
    avgProbLabel: avgProbLabel,
    validatedLabel: validatedLabel,
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

var title = ui.Label('Mapeamento', {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#ffffff',
  textAlign: 'center',
  whiteSpace: 'pre',
  margin: '0',
  padding: '0px',
  border: '0',
  backgroundColor: 'rgba(0,0,0,0)', // <- transparência
  stretch: 'horizontal'              // ajuda o alinhamento central
});

var subtitle = ui.Label('2024-2025', {
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
      backgroundColor: 'rgba(0,0,0,0)',
      padding: '18px',
      margin: '15px 0 0 0',
      border: '1px solid rgba(255,255,255,0.12)',
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

  if (headerSummary) {
    var scopeText = 'Visão geral nacional';
    if (state !== 'Todos' && muni !== 'Todos' && muni !== null) {
      scopeText = muni + ' • ' + state;
    } else if (state !== 'Todos') {
      scopeText = 'Estado selecionado: ' + state;
    }
    headerSummary.filterLabel.setValue(scopeText);
  }
  
  // Filtrar dados vetoriais
  var filteredVector = vectorData;
  var filteredValidated = validatedData;

  if (state !== 'Todos') {
    filteredVector = filteredVector.filter(ee.Filter.eq('uf', state));
    filteredValidated = filteredValidated.filter(ee.Filter.eq('uf', state));
  }

  if (muni !== 'Todos' && muni !== null) {
    filteredVector = filteredVector.filter(ee.Filter.eq('muni_name', muni));
    filteredValidated = filteredValidated.filter(ee.Filter.eq('muni_name', muni));
  }

  // Filtro para FeatureView
  var activeFilters = [];
  if (state !== 'Todos') {
    activeFilters.push(ee.Filter.eq('uf', state));
  }
  if (muni !== 'Todos' && muni !== null) {
    activeFilters.push(ee.Filter.eq('muni_name', muni));
  }

  var viewFilter = null;
  if (activeFilters.length === 1) {
    viewFilter = activeFilters[0];
  } else if (activeFilters.length === 2) {
    viewFilter = ee.Filter.and(activeFilters[0], activeFilters[1]);
  }

  // Adicionar camadas ao mapa
  // Raster com opacidade fixa para visualização sobre satélite
  var opacity = 1;
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
    var vectorLayerOptions = {
      name: 'Polígonos Detectados',
      style: createFeatureViewStyle(metric)
    };
    if (viewFilter) {
      vectorLayerOptions.filter = viewFilter;
    }
    var vectorLayer = ui.Map.FeatureViewLayer(CONFIG.vectorFeatureView, vectorLayerOptions);
    mapPanel.layers().add(vectorLayer);
  }

  // Camada de lixões validados com destaque
  var validatedLayerOptions = {
    name: 'Lixões Validados',
    style: {
      color: '#F31212',
      fillColor: '#F31212',
      width: 3
    }
  };
  if (viewFilter) {
    validatedLayerOptions.filter = viewFilter;
  }
  var validatedLayer = ui.Map.FeatureViewLayer(CONFIG.validatedFeatureView, validatedLayerOptions);
  mapPanel.layers().add(validatedLayer);

  // Centralizar no filtro se específico
  if (muni !== 'Todos' && muni !== null) {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 12);
  } else if (state !== 'Todos') {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 7);
  }
  
  // Atualizar métricas
  updateMetrics(filteredVector, filteredValidated, metric);
  
  // Configurar clique para popup
  mapPanel.onClick(function(coords) {
    var point = ee.Geometry.Point(coords.lon, coords.lat);
    var clicked = filteredVector.filterBounds(point);

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
              backgroundColor: 'rgba(0,0,0,0)',
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
            backgroundColor: 'rgba(0,0,0,0)',
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
function updateMetrics(features, validatedFeatures, probColumn) {
  if (!metrics) {
    return;
  }

  var count = features.size();
  var avgProb = features.aggregate_mean(probColumn);
  var validatedCount = validatedFeatures ? validatedFeatures.size() : ee.Number(0);

  // Atualizar labels básicos com formatação aprimorada
  var totalOcorrencias = count.getInfo();
  var formattedTotal = totalOcorrencias
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  metrics.totalLabel.setValue('Total de ocorrências: ' + formattedTotal);

  var avgProbInfo = avgProb.getInfo();
  var avgProbValue = avgProbInfo
    ? (avgProbInfo * 100).toFixed(1).replace('.', ',')
    : '0,0';
  metrics.avgProbLabel.setValue('Probabilidade média: ' + avgProbValue + '%');

  var validatedTotal = validatedCount.getInfo();
  var formattedValidated = validatedTotal
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  metrics.validatedLabel.setValue('Lixões validados: ' + formattedValidated);

  // Calcular e exibir distribuição por faixa de probabilidade
  var rangeStats = calculateStatsByRange(features, probColumn);
  metrics.lowLabel.setValue('Baixa: ' + rangeStats.baixa + ' áreas');
  metrics.medLabel.setValue('Média: ' + rangeStats.media + ' áreas');
  metrics.highLabel.setValue('Alta: ' + rangeStats.alta + ' áreas');

  if (headerSummary) {
    headerSummary.totalSummaryLabel.setValue(formattedTotal);
    // headerSummary.avgSummaryLabel.setValue(avgProbValue + '%');
    headerSummary.highSummaryLabel.setValue(
      rangeStats.alta
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    );
    if (headerSummary.validatedSummaryLabel) {
      headerSummary.validatedSummaryLabel.setValue(formattedValidated);
    }
  }
}

// ===========================
// INICIALIZAÇÃO
// ===========================

// Carregar dados
print('Carregando dados...');
var rasterData = loadRasterData();
var vectorData = loadVectorData();
var validatedData = loadValidatedVectorData();

// Detectar colunas disponíveis
var probColumns = detectProbabilityColumns(vectorData);

if (probColumns.length === 0) {
  print('ERRO: Nenhuma coluna de probabilidade encontrada (prob_median, prob_media, prob_mean, prob_max)');
  print('Verifique os dados vetoriais');
} else {
  print('Colunas de probabilidade disponíveis:', probColumns);
  print('Coluna padrão selecionada para análise:', probColumns[0]);
  
  // Construir interface
  var filterSection = createFilterSection(vectorData, probColumns);
  filters = filterSection;
  sidePanel.add(filterSection.panel);

  var metricsSection = createMetricsPanel();
  metrics = metricsSection;
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

  headerSummary = createAppHeader();
  appLayout.add(headerSummary.panel);
  appLayout.add(mainPanel);

  // Limpar root e adicionar painel principal
  ui.root.clear();
  ui.root.add(appLayout);

  // Carregar visualização inicial
  updateVisualization();
}
