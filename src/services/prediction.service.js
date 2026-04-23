exports.predict = (data) => {
    if (data.length < 2) {
        return { message: 'Datos insuficientes para predicción' };
    }

    const sorted = data.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    let gastos = [];

    sorted.forEach(item => {
        if (item.tipo === 'gasto') {
            gastos.push(item.monto);
        }
    });

    if (gastos.length === 0) {
        return { message: 'No hay gastos para analizar' };
    }

    const promedio = gastos.reduce((a, b) => a + b, 0) / gastos.length;

    const ultimoGasto = gastos[gastos.length - 1];

    let tendencia = '';
    if (ultimoGasto > promedio) {
        tendencia = 'aumento';
    } else if (ultimoGasto < promedio) {
        tendencia = 'disminucion';
    } else {
        tendencia = 'estable';
    }

    const proximoGastoEstimado = promedio + (ultimoGasto - promedio) * 0.5;

    return {
        promedioGasto: promedio,
        ultimoGasto,
        tendencia,
        proximoGastoEstimado
    };
};