exports.simulate = (data) => {
    let ingresos = 0;
    let gastos = 0;

    data.forEach(item => {
        if (item.tipo === 'ingreso') {
            ingresos += item.monto;
        } else {
            gastos += item.monto;
        }
    });

    const balanceActual = ingresos - gastos;

    // escenario 1: reducir gastos 20%
    const gastosReducidos = gastos * 0.8;
    const nuevoBalance1 = ingresos - gastosReducidos;

    // escenario 2: aumentar ingresos 10%
    const ingresosAumentados = ingresos * 1.1;
    const nuevoBalance2 = ingresosAumentados - gastos;

    // recomendación inteligente
    let recomendacion = '';

    if (balanceActual < 0) {
        recomendacion = 'Reducir gastos urgentemente';
    } else if (balanceActual < ingresos * 0.2) {
        recomendacion = 'Aumentar ingresos o reducir gastos';
    } else {
        recomendacion = 'Buen equilibrio financiero';
    }

    return {
        balanceActual,
        escenarios: {
            reducirGastos20: nuevoBalance1,
            aumentarIngresos10: nuevoBalance2
        },
        recomendacion
    };
};