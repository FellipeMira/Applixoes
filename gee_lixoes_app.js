/**
 * Aplicativo GEE - Análise de Probabilidade de Lixões
 * Visualização interativa com filtros por estado/município e métricas agregadas
 */

// ===========================
// CONFIGURAÇÕES E CONSTANTES
// ===========================

var CONFIG = {
  // Assets
  rasterFolder: 'projects/ee-lixoes/assets/FINAL_RESULTS_BIN',
  vectorAsset: 'projects/lixoes-467518/assets/resultsVect/MEDIAN_IMPROVED_THRESHOLDS_70_MIN_AREAS_1000_SCIKIT_ALL_METRICS_V6',
  
  // Visualização
  probabilityPalette: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
  mapCenter: {lon: -47.93, lat: -15.78}, // Centro do Brasil
  mapZoom: 4,
  
  // Faixas de probabilidade
  probabilityRanges: {
    baixa: [0, 0.75],
    media: [0.75, 0.89],
    alta: [0.89, 1.0]
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

  return feature.set({
    style: {
      color: '#333333',      // Borda cinza escura
      fillColor: color,
      width: 1.5,
      fillOpacity: 0.75
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

var sidePanel = ui.Panel({
  style: {
    width: '420px',
    padding: '15px',
    backgroundColor: '#f5f7fa'
  }
});

var mapPanel = ui.Map();
mapPanel.setCenter(CONFIG.mapCenter.lon, CONFIG.mapCenter.lat, CONFIG.mapZoom);
mapPanel.style().set('cursor', 'crosshair');

// ===========================
// CONSTRUÇÃO DA UI
// ===========================

/**
 * Cria cabeçalho do aplicativo
 */
function createHeader() {
  var header = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#2c3e50',
      padding: '20px',
      margin: '0 0 15px 0',
      border: '0px'
    }
  });

  var title = ui.Label('Análise de Probabilidade de Lixões', {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#ffffff',
    margin: '0 0 8px 0'
  });

  var subtitle = ui.Label('Sistema de monitoramento e análise espacial', {
    fontSize: '13px',
    color: '#ecf0f1',
    fontStyle: 'italic'
  });

  header.add(title);
  header.add(subtitle);

  return header;
}

/**
 * Cria seção de filtros
 */
function createFilterSection(vectorData, probColumns) {
  var filterPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid #e0e0e0'
    }
  });

  filterPanel.add(ui.Label('Filtros', {
    fontWeight: 'bold',
    fontSize: '16px',
    color: '#2c3e50',
    margin: '0 0 12px 0'
  }));

  // Filtro de estado
  var stateLabel = ui.Label('Estado (UF):', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var states = ['Todos'].concat(getUniqueStates(vectorData));
  var stateSelect = ui.Select({
    items: states,
    value: 'Todos',
    style: {width: '100%', margin: '0 0 10px 0'}
  });

  // Filtro de município
  var muniLabel = ui.Label('Município:', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var muniSelect = ui.Select({
    items: ['Todos'],
    value: 'Todos',
    style: {width: '100%', margin: '0 0 10px 0'},
    disabled: true
  });

  // Campo de busca de município
  var muniSearchLabel = ui.Label('Buscar município:', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var muniSearchBox = ui.Textbox({
    placeholder: 'Digite para buscar...',
    style: {width: '100%', margin: '0 0 10px 0'},
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
  
  // Botão aplicar filtros
  var applyButton = ui.Button({
    label: 'Aplicar Filtros',
    style: {
      width: '100%',
      margin: '15px 0 5px 0',
      backgroundColor: '#3498db',
      color: '#ffffff',
      padding: '10px'
    },
    onClick: updateVisualization
  });
  
  filterPanel.add(applyButton);

  return {
    panel: filterPanel,
    stateSelect: stateSelect,
    muniSelect: muniSelect
  };
}

/**
 * Cria painel de métricas
 */
function createMetricsPanel() {
  var metricsPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '1px solid #e0e0e0'
    }
  });

  metricsPanel.add(ui.Label('Métricas', {
    fontWeight: 'bold',
    fontSize: '16px',
    color: '#2c3e50',
    margin: '0 0 12px 0'
  }));

  // Placeholders para métricas
  var totalLabel = ui.Label('Total de ocorrências: -', {
    fontSize: '13px',
    color: '#555',
    margin: '4px 0'
  });
  var avgProbLabel = ui.Label('Probabilidade média: -', {
    fontSize: '13px',
    color: '#555',
    margin: '4px 0 12px 0'
  });

  var rangePanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      margin: '12px 0 0 0',
      padding: '12px',
      backgroundColor: '#f8f9fa',
      border: '1px solid #e9ecef'
    }
  });

  rangePanel.add(ui.Label('Por faixa de probabilidade:', {
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#2c3e50',
    margin: '0 0 8px 0'
  }));
  var lowLabel = ui.Label('🟢 Baixa (0-75%): -', {
    fontSize: '13px',
    color: '#4CAF50',
    margin: '4px 0'
  });
  var medLabel = ui.Label('🟠 Média (75-89%): -', {
    fontSize: '13px',
    color: '#FF9800',
    margin: '4px 0'
  });
  var highLabel = ui.Label('🔴 Alta (89-100%): -', {
    fontSize: '13px',
    color: '#F44336',
    margin: '4px 0'
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
 * Cria legenda para o mapa
 */
function createLegend() {
  var legend = ui.Panel({
    style: {
      position: 'bottom-right',
      padding: '12px 18px',
      backgroundColor: 'white',
      border: '2px solid #333'
    }
  });

  legend.add(ui.Label('Probabilidade de Lixão', {
    fontWeight: 'bold',
    fontSize: '14px',
    color: '#2c3e50',
    margin: '0 0 10px 0'
  }));

  // Três faixas de probabilidade
  var ranges = [
    {color: '#4CAF50', label: 'Baixa (0-75%)', icon: '🟢'},
    {color: '#FF9800', label: 'Média (75-89%)', icon: '🟠'},
    {color: '#F44336', label: 'Alta (89-100%)', icon: '🔴'}
  ];

  ranges.forEach(function(range) {
    var colorBox = ui.Label('', {
      backgroundColor: range.color,
      padding: '12px',
      margin: '0 8px 0 0',
      width: '30px',
      border: '1px solid #333'
    });

    var label = ui.Label(range.icon + ' ' + range.label, {
      margin: '0',
      fontSize: '13px',
      color: '#333'
    });

    var row = ui.Panel({
      widgets: [colorBox, label],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '5px 0'}
    });

    legend.add(row);
  });

  return legend;
}

/**
 * Adiciona logos de apoiadores
 * @param {Array} logoUrls - Array de URLs das logos
 */
function addLogos(logoUrls) {
  var logoPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      backgroundColor: '#f0f0f0',
      padding: '10px',
      margin: '10px 0 0 0'
    }
  });
  
  logoPanel.add(ui.Label('Apoiadores:', {fontWeight: 'bold', margin: '0 10px 0 0'}));
  
  logoUrls.forEach(function(url) {
    var logo = ui.Thumbnail({
      image: ee.Image(1).visualize({palette: ['ffffff']}), // Placeholder
      params: {dimensions: '80x40'},
      style: {margin: '0 10px'}
    });
    
    // Nota: No GEE Apps, logos externas precisam ser carregadas como assets
    // Este é um placeholder para demonstração
    logoPanel.add(logo);
  });
  
  sidePanel.add(logoPanel);
}

// ===========================
// ATUALIZAÇÃO E VISUALIZAÇÃO
// ===========================

/**
 * Atualiza visualização com base nos filtros
 */
function updateVisualization() {
  // Limpar camadas anteriores
  mapPanel.clear();

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
  mapPanel.addLayer(rasterData.select('prob_class0'), {
    min: 0,
    max: 1,
    palette: CONFIG.probabilityPalette
  }, 'Probabilidade Raster', true, 0.7);
  
  mapPanel.addLayer(styledVector.style({styleProperty: 'style'}), {}, 'Unidades Administrativas');
  
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
        var corIcon = '';
        if (prob < 75) {
          faixa = 'Baixa';
          corIcon = '🟢';
        } else if (prob < 89) {
          faixa = 'Média';
          corIcon = '🟠';
        } else {
          faixa = 'Alta';
          corIcon = '🔴';
        }

        var infoPanel = ui.Panel({
          widgets: [
            ui.Label('Informações da Área', {
              fontWeight: 'bold',
              fontSize: '14px',
              color: '#2c3e50',
              margin: '0 0 8px 0'
            }),
            ui.Label('Estado: ' + props.uf, {
              fontSize: '12px',
              color: '#555',
              margin: '2px 0'
            }),
            ui.Label('Município: ' + props.muni_name, {
              fontSize: '12px',
              color: '#555',
              margin: '2px 0'
            }),
            ui.Label(corIcon + ' Probabilidade: ' + probText + ' (' + faixa + ')', {
              fontSize: '12px',
              color: '#555',
              fontWeight: 'bold',
              margin: '6px 0 0 0'
            })
          ],
          style: {
            position: 'bottom-left',
            backgroundColor: 'white',
            padding: '15px',
            border: '2px solid #2c3e50'
          }
        });

        mapPanel.add(infoPanel);
      }
    });
  });
}

/**
 * Atualiza painel de métricas
 */
function updateMetrics(features, probColumn) {
  var count = features.size();
  var avgProb = features.aggregate_mean(probColumn);
  
  // Atualizar labels básicos
  metrics.totalLabel.setValue('Total de ocorrências: ' + count.getInfo());
  metrics.avgProbLabel.setValue('Probabilidade média: ' + 
    (avgProb.getInfo() * 100).toFixed(1).replace('.', ',') + '%');
  
  // Calcular por faixa
  var rangeStats = calculateStatsByRange(features, probColumn);
  metrics.lowLabel.setValue('🟢 Baixa (0-75%): ' + rangeStats.baixa);
  metrics.medLabel.setValue('🟠 Média (75-89%): ' + rangeStats.media);
  metrics.highLabel.setValue('🔴 Alta (89-100%): ' + rangeStats.alta);
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
  sidePanel.add(createHeader());
  
  var filterSection = createFilterSection(vectorData, probColumns);
  var filters = filterSection;
  sidePanel.add(filterSection.panel);
  
  var metricsSection = createMetricsPanel();
  var metrics = metricsSection;
  sidePanel.add(metricsSection.panel);
  
  // Adicionar legenda ao mapa
  mapPanel.add(createLegend());
  
  // Montar layout principal
  mainPanel.add(sidePanel);
  mainPanel.add(mapPanel);
  
  // Limpar root e adicionar painel principal
  ui.root.clear();
  ui.root.add(mainPanel);
  
  // Carregar visualização inicial
  updateVisualization();
  
  // Exemplo de como adicionar logos (substitua com URLs reais dos assets)
  // addLogos(['users/seu_usuario/logo1', 'users/seu_usuario/logo2']);
}
