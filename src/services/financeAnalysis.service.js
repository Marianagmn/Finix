exports.analyze = (data) => {
    let totalIngresos = 0;
    let totalGastos = 0;
    let categorias = {};

    data.forEach(item => {
        if (item.tipo === 'ingreso') {
            totalIngresos += item.monto;
        } else {
            totalGastos += item.monto;

            if (!categorias[item.categoria]) {
                categorias[item.categoria] = 0;
            }
            categorias[item.categoria] += item.monto;
        }
    });

    const balance = totalIngresos - totalGastos;

    let categoriaMayor = null;
    let max = 0;

    for (let cat in categorias) {
        if (categorias[cat] > max) {
            max = categorias[cat];
            categoriaMayor = cat;
        }
    }

    return {
        totalIngresos,
        totalGastos,
        balance,
        categoriaMayorGasto: categoriaMayor,
        gastoPorCategoria: categorias
    };
};